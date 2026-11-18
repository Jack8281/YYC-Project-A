import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();
const db = getFirestore();

const teams = new Set(["Audit 1", "Audit 2", "Audit 11", "Audit 12", "Tax 1", "Tax 2", "Tax 11", "Tax 12"]);
const steps = [
  "Preparation", "Review", "Amendments", "Draft to client",
  "Client review", "Re-review", "Finalisation", "Submission"
];

function serviceForTeam(team) {
  return String(team || "").startsWith("Audit ") ? "Audit" :
    String(team || "").startsWith("Tax ") ? "Tax" : "";
}

function requiredText(value, field, maxLength = 180) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  return value.trim();
}

async function getAccount(request, roles) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const account = await db.collection("users").doc(request.auth.uid).get();
  if (!account.exists) {
    throw new HttpsError("permission-denied", "Your account is not permitted to do this.");
  }
  const origin = request.rawRequest.get("origin") || "";
  const localTestingOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin);
  if (request.auth.token.email_verified !== true &&
      !(localTestingOrigin && account.get("allowUnverifiedTesting") === true)) {
    throw new HttpsError("permission-denied", "Verify your email before using the job dashboard.");
  }
  if (!account.exists || !roles.includes(account.get("role")) ||
      account.get("email")?.toLowerCase() !== request.auth.token.email?.toLowerCase()) {
    throw new HttpsError("permission-denied", "Your account is not permitted to do this.");
  }
  return { uid: request.auth.uid, ...account.data() };
}

function validateTeam(team) {
  if (!teams.has(team)) throw new HttpsError("invalid-argument", "Choose one of the configured Tax or Audit teams.");
}

function validateDate(value, field) {
  const parsedDate = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(parsedDate?.getTime()) || parsedDate.toISOString().slice(0, 10) !== value) {
    throw new HttpsError("invalid-argument", `${field} must be a valid date.`);
  }
  return value;
}

function teamCounterId(team) {
  return team.toLowerCase().replaceAll(" ", "-");
}

async function updateJobWithEvent(jobRef, changes, actor, action) {
  const batch = db.batch();
  const eventRef = jobRef.collection("events").doc();
  batch.update(jobRef, changes);
  batch.set(eventRef, {
    action,
    actorUid: actor.uid,
    actorName: actor.displayName || actor.email,
    occurredAt: FieldValue.serverTimestamp()
  });
  await batch.commit();
}

export const createClient = onCall(async request => {
  const director = await getAccount(request, ["director", "management"]);
  const team = requiredText(request.data?.team, "Team", 20);
  const name = requiredText(request.data?.clientName, "Client name");
  validateTeam(team);
  const service = serviceForTeam(team);
  const counterRef = db.collection("teamCounters").doc(teamCounterId(team));
  const clientRef = db.collection("clients").doc();

  await db.runTransaction(async transaction => {
    const counter = await transaction.get(counterRef);
    let clientCount;
    if (counter.exists) {
      clientCount = Number(counter.get("clientCount"));
    } else {
      const existing = await transaction.get(db.collection("clients").where("team", "==", team));
      clientCount = existing.size;
    }
    if (!Number.isInteger(clientCount) || clientCount < 0 || clientCount >= 250) {
      throw new HttpsError("failed-precondition", `${team} already has 250 clients.`);
    }

    transaction.create(clientRef, {
      name,
      team,
      service,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: director.uid
    });
    transaction.set(counterRef, {
      team,
      clientCount: clientCount + 1,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return { clientId: clientRef.id };
});

export const createJob = onCall(async request => {
  const director = await getAccount(request, ["director", "management"]);
  const clientId = requiredText(request.data?.clientId, "Client");
  const service = requiredText(request.data?.service, "Service", 10);
  const team = requiredText(request.data?.team, "Team", 20);
  const fye = validateDate(request.data?.fye, "Financial year end");
  const maReceivedAt = validateDate(request.data?.maReceivedAt, "MA received date");
  validateTeam(team);
  if (!["Tax", "Audit"].includes(service) || serviceForTeam(team) !== service) {
    throw new HttpsError("invalid-argument", "The selected service and team must match.");
  }

  const clientSnapshot = await db.collection("clients").doc(clientId).get();
  if (!clientSnapshot.exists || clientSnapshot.get("service") !== service) {
    throw new HttpsError("failed-precondition", "Select an existing client in the chosen service.");
  }
  const jobRef = db.collection("jobs").doc();
  const year = new Date(`${maReceivedAt}T00:00:00Z`).getUTCFullYear();
  const jobId = `YYC-${year}-${jobRef.id.slice(0, 6).toUpperCase()}`;
  const batch = db.batch();
  batch.set(jobRef, {
    jobId,
    clientId,
    clientName: clientSnapshot.get("name"),
    service,
    team,
    fye,
    maReceivedAt,
    targetDays: service === "Tax" ? 65 : 45,
    assignedUid: "",
    assignedName: "Unassigned",
    currentStep: steps[0],
    status: "On track",
    reviewStatus: "not_requested",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: director.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: director.uid
  });
  batch.set(jobRef.collection("events").doc(), {
    action: "Job created and routed to a team",
    actorUid: director.uid,
    actorName: director.displayName || director.email,
    occurredAt: FieldValue.serverTimestamp()
  });
  await batch.commit();
  return { jobId };
});

export const assignJobTeam = onCall(async request => {
  const director = await getAccount(request, ["director", "management"]);
  const jobId = requiredText(request.data?.jobId, "Job");
  const team = requiredText(request.data?.team, "Team", 20);
  validateTeam(team);
  const jobRef = db.collection("jobs").doc(jobId);
  const job = await jobRef.get();
  if (!job.exists) throw new HttpsError("not-found", "Job not found.");
  if (job.get("reviewStatus") === "approved") {
    throw new HttpsError("failed-precondition", "Completed jobs cannot be rerouted.");
  }
  const service = serviceForTeam(team);
  const client = await db.collection("clients").doc(job.get("clientId")).get();
  if (!client.exists || client.get("service") !== service) {
    throw new HttpsError("failed-precondition", "The job's client is not in the selected service.");
  }
  await updateJobWithEvent(jobRef, {
    team,
    service,
    targetDays: service === "Tax" ? 65 : 45,
    assignedUid: "",
    assignedName: "Unassigned",
    reviewStatus: "not_requested",
    status: "On track",
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: director.uid
  }, director, `Job routed to ${team}`);
  return { jobId };
});

export const assignJob = onCall(async request => {
  const manager = await getAccount(request, ["manager"]);
  const jobId = requiredText(request.data?.jobId, "Job");
  const workerUid = requiredText(request.data?.workerUid, "Worker", 128);
  const jobRef = db.collection("jobs").doc(jobId);
  const workerRef = db.collection("users").doc(workerUid);
  const [job, worker] = await Promise.all([jobRef.get(), workerRef.get()]);
  if (!job.exists) throw new HttpsError("not-found", "Job not found.");
  if (!worker.exists || worker.get("role") !== "worker" ||
      worker.get("team") !== job.get("team") || worker.get("service") !== job.get("service")) {
    throw new HttpsError("failed-precondition", "Choose a worker assigned to the job's team and service.");
  }
  if (manager.service !== job.get("service") || manager.team !== job.get("team")) {
    throw new HttpsError("permission-denied", "Managers can assign only jobs in their own team.");
  }
  if (job.get("reviewStatus") === "approved") {
    throw new HttpsError("failed-precondition", "Completed jobs cannot be reassigned.");
  }
  await updateJobWithEvent(jobRef, {
    assignedUid: workerUid,
    assignedName: worker.get("displayName") || worker.get("email"),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: manager.uid
  }, manager, `Job assigned to ${worker.get("displayName") || worker.get("email")}`);
  return { jobId, workerUid };
});

export const advanceJob = onCall(async request => {
  const worker = await getAccount(request, ["worker"]);
  const jobId = requiredText(request.data?.jobId, "Job");
  const jobRef = db.collection("jobs").doc(jobId);
  const job = await jobRef.get();
  if (!job.exists || job.get("assignedUid") !== worker.uid) {
    throw new HttpsError("permission-denied", "You can update only jobs assigned to you.");
  }
  const reviewStatus = job.get("reviewStatus");
  const currentStep = job.get("currentStep");
  if (reviewStatus === "pending_manager_review" || reviewStatus === "approved") {
    throw new HttpsError("failed-precondition", "This job is waiting for manager review or is already complete.");
  }
  const update = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: worker.uid,
    updatedByName: worker.displayName || worker.email
  };
  if (reviewStatus === "changes_requested") {
    update.reviewStatus = "pending_manager_review";
    update.status = "Pending manager review";
  } else if (currentStep === "Submission") {
    update.reviewStatus = "pending_manager_review";
    update.status = "Pending manager review";
  } else {
    const nextIndex = steps.indexOf(currentStep) + 1;
    if (nextIndex <= 0 || nextIndex >= steps.length) {
      throw new HttpsError("failed-precondition", "The job step is invalid.");
    }
    update.currentStep = steps[nextIndex];
  }
  await updateJobWithEvent(jobRef, update, worker, `Progress updated at ${currentStep}`);
  return { jobId };
});

export const reviewJob = onCall(async request => {
  const manager = await getAccount(request, ["manager"]);
  const jobId = requiredText(request.data?.jobId, "Job");
  const decision = requiredText(request.data?.decision, "Review decision", 12);
  if (!["approve", "return"].includes(decision)) {
    throw new HttpsError("invalid-argument", "Choose approve or return.");
  }
  const jobRef = db.collection("jobs").doc(jobId);
  const job = await jobRef.get();
  if (!job.exists) throw new HttpsError("not-found", "Job not found.");
  if (manager.team !== job.get("team") || manager.service !== job.get("service")) {
    throw new HttpsError("permission-denied", "Managers can review only their own team's jobs.");
  }
  if (job.get("reviewStatus") !== "pending_manager_review") {
    throw new HttpsError("failed-precondition", "This job is not waiting for review.");
  }
  await updateJobWithEvent(jobRef, {
    reviewStatus: decision === "approve" ? "approved" : "changes_requested",
    status: decision === "approve" ? "Completed" : "Changes requested",
    reviewedBy: manager.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: manager.uid
  }, manager, decision === "approve" ? "Job approved" : "Job returned for changes");
  return { jobId, decision };
});
