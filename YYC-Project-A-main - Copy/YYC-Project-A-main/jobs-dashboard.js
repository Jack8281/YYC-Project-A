import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { auth, db, functions, isLocalDevelopment } from "./firebase-config.js?v=20261029-3";

const TEAM_NAMES = ["Audit 1", "Audit 2", "Audit 11", "Audit 12", "Tax 1", "Tax 2", "Tax 11", "Tax 12"];
const JOB_STEPS = [
  "Preparation", "Review", "Amendments", "Draft to client",
  "Client review", "Re-review", "Finalisation", "Submission"
];
const ROLE_PAGES = {
  worker: "worker-page.html",
  manager: "manager-page.html",
  director: "director-page.html",
  management: "management-page.html"
};
const api = {
  createClient: httpsCallable(functions, "createClient"),
  createJob: httpsCallable(functions, "createJob"),
  assignJob: httpsCallable(functions, "assignJob"),
  assignJobTeam: httpsCallable(functions, "assignJobTeam"),
  advanceJob: httpsCallable(functions, "advanceJob"),
  reviewJob: httpsCallable(functions, "reviewJob")
};
let currentUser;
let profile;
let jobs = [];
let staff = [];
let clients = [];
let toastTimer;
let unsubscribeJobs;

function showMessage(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4500);
}

function showFailure(message, error) {
  console.error(message, error);
  showMessage(message);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function teamService(team) {
  return String(team || "").startsWith("Audit ") ? "Audit" :
    String(team || "").startsWith("Tax ") ? "Tax" : "";
}

function getDays(job) {
  const start = new Date(`${job.maReceivedAt}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
}

function directorSampleJobs() {
  const dateDaysAgo = days => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const now = new Date();
  return [
    {
      id: "sample-job-001", jobId: "SAMPLE-001", clientName: "Northstar Trading Sdn Bhd",
      service: "Tax", team: "Tax 1", assignedName: "Alicia Tan", currentStep: "Preparation",
      maReceivedAt: dateDaysAgo(18), fye: "2025-12-31", targetDays: 65,
      reviewStatus: "not_requested", updatedAt: now
    },
    {
      id: "sample-job-002", jobId: "SAMPLE-002", clientName: "Evergreen Manufacturing Sdn Bhd",
      service: "Audit", team: "Audit 2", assignedName: "Daniel Lim", currentStep: "Client review",
      maReceivedAt: dateDaysAgo(42), fye: "2025-09-30", targetDays: 45,
      reviewStatus: "not_requested", updatedAt: now
    },
    {
      id: "sample-job-003", jobId: "SAMPLE-003", clientName: "Cedar & Co. Retail Sdn Bhd",
      service: "Tax", team: "Tax 11", assignedName: "Mei Wong", currentStep: "Submission",
      maReceivedAt: dateDaysAgo(55), fye: "2025-06-30", targetDays: 65,
      reviewStatus: "pending_manager_review", updatedAt: now
    },
    {
      id: "sample-job-004", jobId: "SAMPLE-004", clientName: "Bluewater Logistics Sdn Bhd",
      service: "Audit", team: "Audit 12", assignedName: "Unassigned", currentStep: "Preparation",
      maReceivedAt: dateDaysAgo(58), fye: "2025-03-31", targetDays: 45,
      reviewStatus: "not_requested", updatedAt: now
    },
    {
      id: "sample-job-005", jobId: "SAMPLE-005", clientName: "Silverline Digital Sdn Bhd",
      service: "Tax", team: "Tax 2", assignedName: "Ryan Lee", currentStep: "Submission",
      maReceivedAt: dateDaysAgo(70), fye: "2024-12-31", targetDays: 65,
      reviewStatus: "approved", updatedAt: now
    },
    {
      id: "sample-job-006", jobId: "SAMPLE-006", clientName: "Maple Grove Services Sdn Bhd",
      service: "Audit", team: "Audit 1", assignedName: "Unassigned", currentStep: "Review",
      maReceivedAt: dateDaysAgo(27), fye: "2025-12-31", targetDays: 45,
      reviewStatus: "not_requested", updatedAt: now
    },
    {
      id: "sample-job-007", jobId: "SAMPLE-007", clientName: "Summit Healthcare Sdn Bhd",
      service: "Audit", team: "Audit 11", assignedName: "Sofia Ng", currentStep: "Amendments",
      maReceivedAt: dateDaysAgo(36), fye: "2025-09-30", targetDays: 45,
      reviewStatus: "changes_requested", updatedAt: now
    },
    {
      id: "sample-job-008", jobId: "SAMPLE-008", clientName: "Brightpath Education Sdn Bhd",
      service: "Tax", team: "Tax 12", assignedName: "Unassigned", currentStep: "Preparation",
      maReceivedAt: dateDaysAgo(12), fye: "2025-06-30", targetDays: 65,
      reviewStatus: "not_requested", updatedAt: now
    }
  ];
}

function managementSampleJobs() {
  const teams = [
    { name: "Audit 1", days: [18, 22, 26, 31, 40] },
    { name: "Audit 2", days: [14, 25, 40, 50] },
    { name: "Audit 11", days: [10, 20, 30, 34, 50] },
    { name: "Audit 12", days: [10, 20, 25, 40] },
    { name: "Tax 1", days: [20, 30, 55, 60, 70] },
    { name: "Tax 2", days: [20, 30, 60, 70] },
    { name: "Tax 11", days: [12, 19, 26, 33, 40, 45, 50, 54, 60, 70] },
    { name: "Tax 12", days: [20, 40, 60] }
  ];
  const clientNames = [
    "Seri Mutiara Holdings Sdn Bhd", "Puncak Jaya Properties Sdn Bhd",
    "Lembah Hijau Plantation Sdn Bhd", "Permata Ilmu Education Sdn Bhd",
    "Cahaya Kraf Industries Sdn Bhd", "Tanjung Murni Foods Sdn Bhd",
    "Sinar Bayu Electrical Sdn Bhd", "Delima Marine Services Sdn Bhd",
    "Bintang Timur Logistics Sdn Bhd", "Kristal Bina Development Sdn Bhd"
  ];
  const workerNames = ["Aisyah Rahman", "Hafiz Azman", "Daniel Tan", "Wong Mei Ling", "Lim Chee Keong"];
  const steps = ["Preparation", "Review", "Amendments", "Draft to client", "Client review", "Re-review", "Finalisation"];
  const delayReasons = ["Waiting for documents", "Client not responding", "Workload", "Technical issue"];
  const dateString = date => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
  const now = new Date();
  let number = 1;
  return teams.flatMap(({ name: team, days }) => days.map(age => {
    const service = teamService(team);
    const received = new Date();
    received.setHours(0, 0, 0, 0);
    received.setDate(received.getDate() - age);
    const receivedAt = dateString(received);
    const fyeDate = new Date(received);
    fyeDate.setMonth(fyeDate.getMonth() - 3);
    return {
      id: `management-sample-${number}`,
      jobId: `${service === "Tax" ? "T" : "A"}-2026-${String(140 + number).padStart(4, "0")}`,
      clientName: clientNames[(number - 1) % clientNames.length],
      service,
      team,
      assignedName: workerNames[(number - 1) % workerNames.length],
      currentStep: steps[(number - 1) % steps.length],
      maReceivedAt: receivedAt,
      fye: dateString(fyeDate),
      targetDays: service === "Tax" ? 65 : 45,
      reviewStatus: "not_requested",
      delayReason: age > (service === "Tax" ? 55 : 35)
        ? delayReasons[(number - 1) % delayReasons.length]
        : "",
      updatedAt: now
    };
  }).map(job => {
    number += 1;
    return job;
  }));
}

function effectiveStatus(job) {
  if (job.reviewStatus === "pending_manager_review") return "Pending manager review";
  if (job.reviewStatus === "changes_requested") return "Changes requested";
  if (job.reviewStatus === "approved") return "Completed";
  const days = getDays(job);
  if (days > Number(job.targetDays)) return "Overdue";
  if (days >= Number(job.targetDays) - 10) return "At risk";
  return "On track";
}

function statusClass(status) {
  if (status === "Overdue") return "status-overdue";
  if (status === "At risk") return "status-at-risk";
  if (status === "Pending manager review" || status === "Changes requested") return "status-pending";
  if (status === "Completed") return "status-completed";
  return "status-on-track";
}

function optionList(values, selected = "") {
  return values.map(value =>
    `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`
  ).join("");
}

function populateStaticFilters() {
  document.getElementById("teamFilter")?.insertAdjacentHTML("beforeend", optionList(TEAM_NAMES));
  const clientTeamInput = document.getElementById("clientTeamInput");
  if (clientTeamInput) clientTeamInput.innerHTML = optionList(TEAM_NAMES);
  const jobTeamInput = document.getElementById("jobTeamInput");
  if (jobTeamInput) {
    jobTeamInput.innerHTML = optionList(TEAM_NAMES);
    jobTeamInput.value = "Tax 1";
  }
}

function setupRoleInterface() {
  const isWorker = profile.role === "worker";
  const isManager = profile.role === "manager";
  const name = profile.displayName || currentUser.displayName || currentUser.email;
  document.body.innerHTML = profile.role === "management"
    ? managementWorkspaceMarkup(name)
    : roleWorkspaceMarkup(profile.role, name);
  document.getElementById("sidebarUserName").textContent = name;
  document.getElementById("sidebarUserRole").textContent = isWorker
    ? `Worker · ${profile.team || profile.service || "assigned jobs"}`
    : isManager ? `Manager · ${profile.team}`
      : `${profile.role === "management" ? "Management" : "Director"} · all teams`;
  if (isLocalDevelopment) {
    document.querySelector(".sidebar-note").textContent = "Firestore records · Read-only preview";
  }
}

function managementWorkspaceMarkup(name) {
  return `<aside class="sidebar">
    <a class="brand-wrap" href="management-page.html">
      <span class="brand-logo">YYC</span>
      <span class="brand-text"><span class="brand-title">Job Control</span><span class="brand-sub">Audit &amp; Tax</span></span>
    </a>
    <span class="management-access">Management access · all teams</span>
    <nav class="management-nav" aria-label="Management navigation">
      <button type="button" class="management-nav-button is-active" data-management-view="overview">Management Dashboard</button>
      <button type="button" class="management-nav-button" data-management-view="team">Team Board <span id="navTeamName">Tax 11</span></button>
    </nav>
    <div class="sidebar-bottom">
      <span class="user-name" id="sidebarUserName">${escapeHtml(name)}</span>
      <span class="user-role" id="sidebarUserRole">Management · all teams</span>
      <span class="sidebar-note">All service teams · ${isLocalDevelopment ? "Preview" : "Live data"}</span>
      <button class="signout-btn" id="signOutButton" type="button">Sign Out</button>
    </div>
  </aside>
  <main class="main-content management-content">
    ${isLocalDevelopment ? '<p class="management-preview-note">Preview mode · sample jobs are shown only when Firestore has no job records, and are not saved.</p>' : ""}
    <section id="managementOverview">
      <header class="management-header">
        <div><h1>Management Dashboard</h1><p class="subtitle">All 8 teams · Target: first draft to client within 45 days (audit) or 65 days (tax) of MA received.</p></div>
        <button type="button" class="button-secondary export-button" data-export="all">Export to Excel</button>
      </header>
      <div class="management-stats">
        <article class="management-stat"><span>Active jobs</span><strong id="managementActive">0</strong></article>
        <article class="management-stat"><span>Within target (this year)</span><strong id="managementWithinTarget">0%</strong></article>
        <article class="management-stat risk"><span>At risk</span><strong id="managementRisk">0</strong></article>
        <article class="management-stat overdue"><span>Overdue</span><strong id="managementOverdue">0</strong></article>
      </div>
      <section class="management-panel team-summary-panel">
        <table class="management-team-table">
          <thead><tr><th>Team</th><th>Active jobs</th><th>Within target</th><th>At risk</th><th>Overdue</th></tr></thead>
          <tbody id="managementTeamRows"></tbody>
        </table>
      </section>
      <div class="management-chart-grid">
        <section class="management-panel chart-panel">
          <h2>Ageing of open jobs</h2><p>Days since MA received, all teams</p>
          <div id="managementAgeChart"></div>
        </section>
        <section class="management-panel chart-panel">
          <h2>Top delay reasons</h2><p>Delays recorded in open jobs, all teams</p>
          <div id="managementDelayChart"></div>
        </section>
      </div>
    </section>
    <section id="managementTeamBoard" hidden>
      <header class="management-header">
        <div><h1>Team Board <span class="team-board-title" id="teamBoardTitle">Tax 11</span></h1><p class="subtitle" id="teamBoardSummary"></p></div>
        <div class="team-board-controls">
          <label for="managementTeamSelect">Team</label>
          <select id="managementTeamSelect">${optionList(TEAM_NAMES, "Tax 11")}</select>
          <button type="button" class="button-secondary export-button" data-export="team">Export to Excel</button>
        </div>
      </header>
      <div class="management-board-scroll"><div class="management-board" id="managementBoard"></div></div>
    </section>
  </main>
  <div class="toast" id="toast" role="status" hidden></div>`;
}

function roleWorkspaceMarkup(role, name) {
  const isWorker = role === "worker";
  const isDirector = role === "director" || role === "management";
  const title = isWorker ? "My Jobs" : role === "manager" ? "Team Job Control" : "Director Job Control";
  const subtitle = isWorker
    ? "Your assigned jobs only. Preview the step updates and manager handoff."
    : role === "manager"
      ? "Search staff by name or team and review progress across Tax and Audit."
      : "Search staff by name or team, manage client portfolios, and route jobs to service teams.";

  return `<aside class="sidebar">
    <a class="brand-wrap" href="${ROLE_PAGES[role]}">
      <span class="brand-logo">YYC</span>
      <span class="brand-text"><span class="brand-title">Job Control</span><span class="brand-sub">Audit &amp; Tax</span></span>
    </a>
    <div class="sidebar-bottom">
      <span class="user-name" id="sidebarUserName">${escapeHtml(name)}</span>
      <span class="user-role" id="sidebarUserRole"></span>
      <span class="sidebar-note">Live job register · Firestore</span>
      <button class="signout-btn" id="signOutButton" type="button">Sign Out</button>
    </div>
  </aside>
  <main class="main-content">
    <header class="content-header"><h1 id="pageTitle">${title}</h1><p class="subtitle" id="pageSubtitle">${subtitle}</p></header>
    <section class="stats" aria-label="Job summary">
      <article class="stat-card"><span class="stat-label">Active jobs</span><strong class="stat-value" id="activeCount">0</strong></article>
      <article class="stat-card stat-overdue"><span class="stat-label">Overdue</span><strong class="stat-value" id="overdueCount">0</strong></article>
      <article class="stat-card stat-risk"><span class="stat-label">At risk</span><strong class="stat-value" id="riskCount">0</strong></article>
      <article class="stat-card stat-track"><span class="stat-label">Awaiting review</span><strong class="stat-value" id="reviewCount">0</strong></article>
    </section>
    ${isDirector ? `<section class="panel form-panel" id="clientFormPanel">
      <h2 class="section-title">Add a client to a team portfolio</h2><p class="note">Each team can manage up to 250 clients.</p>
      <p class="note" id="clientCountNote" role="status">Loading client records…</p>
      <form class="form-grid" id="clientForm">
        <div class="field"><label for="clientNameInput">Client name</label><input id="clientNameInput" name="clientName" required maxlength="160"></div>
        <div class="field"><label for="clientTeamInput">Team</label><select id="clientTeamInput" name="team" required></select></div>
        <button class="button-primary" id="addClientButton" type="submit">Add client</button>
      </form>
    </section>
    <section class="panel form-panel" id="jobFormPanel">
      <h2 class="section-title">Create and route a job</h2><p class="note">Choose the service team. The team manager assigns a worker.</p>
      ${isLocalDevelopment ? '<p class="note">Preview interactions only: changes are temporary and will not be saved to Firebase.</p>' : ""}
      <form class="form-grid" id="jobForm">
        <div class="field"><label for="jobClientInput">Client</label><select id="jobClientInput" name="clientId" required></select></div>
        <div class="field"><label for="jobServiceInput">Service</label><select id="jobServiceInput" name="service" required><option>Tax</option><option>Audit</option></select></div>
        <div class="field"><label for="jobTeamInput">Assigned team</label><select id="jobTeamInput" name="team" required></select></div>
        <div class="field"><label for="jobFyeInput">Financial year end</label><input id="jobFyeInput" name="fye" type="date" required></div>
        <div class="field"><label for="maDateInput">MA received</label><input id="maDateInput" name="maReceivedAt" type="date" required></div>
        <button class="button-primary" type="submit">Create job</button>
      </form>
    </section>` : ""}
    ${!isWorker ? `<section class="toolbar" id="searchToolbar" aria-label="Search staff and filter jobs">
      <div class="field"><label for="staffSearch">Search worker name</label><input id="staffSearch" type="search" placeholder="Search assigned worker"></div>
      <div class="field"><label for="teamFilter">Team number</label><select id="teamFilter"><option value="">All teams</option></select></div>
      <div class="field"><label for="serviceFilter">Service</label><select id="serviceFilter"><option value="">All services</option><option>Tax</option><option>Audit</option></select></div>
      <div class="field"><label for="statusFilter">Status</label><select id="statusFilter"><option value="">All statuses</option><option>On track</option><option>At risk</option><option>Overdue</option><option>Pending manager review</option><option>Changes requested</option><option>Completed</option></select></div>
    </section>` : ""}
    <section class="panel" aria-label="Job register">
      <div class="panel-heading"><div><h2 class="section-title" id="tableTitle">${isWorker ? "Jobs assigned to me" : "Job register"}</h2><p id="tableSubtitle">${isWorker ? "Only jobs assigned to your staff account are shown." : "Live records from Firestore."}</p></div></div>
      ${isLocalDevelopment ? '<p class="note">Firebase records are read-only. Any sample jobs shown for this preview are temporary and are not saved to Firebase.</p>' : ""}
      <div class="table-scroll"><table class="jobs-table">
        <thead><tr><th>Job ID</th><th>Client / service</th><th>Team</th><th>Assigned worker</th><th>Current step</th><th>Status</th><th>Days / target</th><th>Last update</th><th>Action</th></tr></thead>
        <tbody id="jobsBody"></tbody>
      </table></div>
      <div class="empty-state" id="emptyState" hidden></div>
    </section>
  </main>
  <div class="toast" id="toast" role="status" hidden></div>`;
}
function renderClientOptions() {
  const selector = document.getElementById("jobClientInput");
  const selected = selector.value;
  selector.innerHTML = clients.length
    ? `<option value="">Select a client</option>${clients.map(client =>
      `<option value="${escapeHtml(client.id)}" ${client.id === selected ? "selected" : ""}>${escapeHtml(client.name)} · ${escapeHtml(client.team)}</option>`
    ).join("")}`
    : '<option value="">No clients are configured yet</option>';
}

function updateClientCount() {
  const team = document.getElementById("clientTeamInput").value;
  const count = clients.filter(client => client.team === team).length;
  document.getElementById("clientCountNote").textContent = clients.length === 0
    ? "No client records were found in Firestore. Client and job forms are previews until Functions are deployed."
    : `${team}: ${count} of 250 clients`;
  document.getElementById("addClientButton").disabled = count >= 250;
}

function formatUpdatedAt(timestamp) {
  const updatedAt = timestamp instanceof Date ? timestamp :
    timestamp && typeof timestamp.toDate === "function" ? timestamp.toDate() : null;
  if (!updatedAt) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(updatedAt);
}

function jobMatchesFilters(job) {
  if (profile.role === "worker" && job.assignedUid !== currentUser.uid) return false;

  const staffSearch = document.getElementById("staffSearch")?.value.trim().toLowerCase() || "";
  const team = document.getElementById("teamFilter")?.value || "";
  const service = document.getElementById("serviceFilter")?.value || "";
  const status = document.getElementById("statusFilter")?.value || "";
  if (staffSearch && !(job.assignedName || "").toLowerCase().includes(staffSearch)) return false;
  if (team && job.team !== team) return false;
  if (service && job.service !== service) return false;
  if (status && effectiveStatus(job) !== status) return false;
  return true;
}

function renderJobs() {
  if (profile.role === "management") {
    renderManagementWorkspace();
    return;
  }
  const ordered = [...jobs].sort((a, b) => {
    const priority = {
      Overdue: 0, "At risk": 1, "Pending manager review": 2,
      "Changes requested": 3, "On track": 4, Completed: 5
    };
    return (priority[effectiveStatus(a)] ?? 5) - (priority[effectiveStatus(b)] ?? 5) || getDays(b) - getDays(a);
  });
  const visible = ordered.filter(jobMatchesFilters);
  const body = document.getElementById("jobsBody");
  document.getElementById("emptyState").hidden = visible.length > 0;
  document.getElementById("emptyState").textContent = jobs.length === 0 && isDirectorProfile()
    ? "No job records are in Firestore yet. Once clients and jobs are added, they will appear here."
    : jobs.length === 0 && profile.role === "manager"
      ? "No job records are in Firestore yet."
      : "No jobs match your access and filters.";
  body.innerHTML = visible.map(job => {
    const status = effectiveStatus(job);
    const days = getDays(job);
    let actions = "";

    if (profile.role === "worker" && job.reviewStatus !== "pending_manager_review" &&
        job.reviewStatus !== "approved") {
      const label = job.reviewStatus === "changes_requested"
        ? "Resubmit for review"
        : job.currentStep === "Submission" ? "Submit to manager" : `Done: ${job.currentStep}`;
      actions = `<button class="button-primary" type="button" data-action="advance" data-job-id="${escapeHtml(job.id)}">${escapeHtml(label)}</button>`;
    } else if (profile.role === "manager" && job.team === profile.team) {
      if (job.reviewStatus === "pending_manager_review") {
        actions = `<button class="button-primary" type="button" data-action="approve" data-job-id="${escapeHtml(job.id)}">Approve</button>
          <button class="button-secondary" type="button" data-action="return" data-job-id="${escapeHtml(job.id)}">Return to worker</button>`;
      } else if (job.reviewStatus !== "approved") {
        const teamStaff = staff.filter(person => person.role === "worker" && person.team === job.team &&
          person.service === job.service);
        actions = `<select class="table-select" data-assignee="${escapeHtml(job.id)}" aria-label="Assign ${escapeHtml(job.jobId)} to worker">
          <option value="">Choose worker</option>${teamStaff.map(person =>
            `<option value="${escapeHtml(person.id)}" ${person.id === job.assignedUid ? "selected" : ""}>${escapeHtml(person.displayName || person.name || person.email)}</option>`
          ).join("")}</select>
          <button class="button-secondary" type="button" data-action="assign" data-job-id="${escapeHtml(job.id)}">Assign</button>`;
      }
    } else if (isDirectorProfile() && job.reviewStatus !== "approved") {
      actions = `<select class="table-select" data-team="${escapeHtml(job.id)}" aria-label="Choose team for ${escapeHtml(job.jobId)}">${optionList(TEAM_NAMES, job.team)}</select>
        <button class="button-secondary" type="button" data-action="route" data-job-id="${escapeHtml(job.id)}">Route team</button>`;
    }

    return `<tr>
      <td><span class="job-id">${escapeHtml(job.jobId || job.id)}</span></td>
      <td><span class="client-name">${escapeHtml(job.clientName)}</span><span class="client-meta">${escapeHtml(job.service)} · FYE ${escapeHtml(job.fye || "—")}</span></td>
      <td>${escapeHtml(job.team)}</td>
      <td>${escapeHtml(job.assignedName || "Unassigned")}</td>
      <td>${escapeHtml(job.currentStep || "Preparation")}</td>
      <td><span class="status-chip ${statusClass(status)}">${escapeHtml(status)}</span></td>
      <td class="days-cell">Day ${days} / ${escapeHtml(job.targetDays)}</td>
      <td>${escapeHtml(formatUpdatedAt(job.updatedAt))}</td>
      <td><div class="action-group">${actions || "—"}</div></td>
    </tr>`;
  }).join("");
  if (isLocalDevelopment && profile.role !== "director" && profile.role !== "management") {
    body.querySelectorAll("button, select").forEach(control => {
      const isSampleWorkerAction = profile.role === "worker" &&
        control.dataset.action === "advance" &&
        control.dataset.jobId?.startsWith("sample-job-");
      if (!isSampleWorkerAction) control.disabled = true;
    });
  }

  const scopedJobs = profile.role === "worker"
    ? jobs.filter(job => job.assignedUid === currentUser.uid)
    : jobs;
  document.getElementById("activeCount").textContent = scopedJobs.filter(job => effectiveStatus(job) !== "Completed").length;
  document.getElementById("overdueCount").textContent = scopedJobs.filter(job => effectiveStatus(job) === "Overdue").length;
  document.getElementById("riskCount").textContent = scopedJobs.filter(job => effectiveStatus(job) === "At risk").length;
  document.getElementById("reviewCount").textContent = scopedJobs.filter(job => effectiveStatus(job) === "Pending manager review").length;
}

function renderManagementWorkspace() {
  const activeJobs = jobs.filter(job => effectiveStatus(job) !== "Completed");
  const atRiskJobs = activeJobs.filter(job => effectiveStatus(job) === "At risk");
  const overdueJobs = activeJobs.filter(job => effectiveStatus(job) === "Overdue");
  const onTargetCount = activeJobs.filter(job => getDays(job) <= Number(job.targetDays)).length;
  document.getElementById("managementActive").textContent = activeJobs.length;
  document.getElementById("managementWithinTarget").textContent =
    `${activeJobs.length ? Math.round((onTargetCount / activeJobs.length) * 100) : 0}%`;
  document.getElementById("managementRisk").textContent = atRiskJobs.length;
  document.getElementById("managementOverdue").textContent = overdueJobs.length;

  document.getElementById("managementTeamRows").innerHTML = TEAM_NAMES.map(team => {
    const teamJobs = activeJobs.filter(job => job.team === team);
    const withinTarget = teamJobs.length
      ? Math.round(teamJobs.filter(job => getDays(job) <= Number(job.targetDays)).length / teamJobs.length * 100)
      : 0;
    const riskCount = teamJobs.filter(job => effectiveStatus(job) === "At risk").length;
    const overdueCount = teamJobs.filter(job => effectiveStatus(job) === "Overdue").length;
    const barClass = withinTarget < 80 ? "is-warning" : "";
    return `<tr tabindex="0" role="button" data-open-team="${escapeHtml(team)}">
      <th scope="row">${escapeHtml(team)}</th><td>${teamJobs.length}</td>
      <td><div class="target-cell"><span class="target-track"><span class="${barClass}" style="width:${withinTarget}%"></span></span><b>${withinTarget}%</b></div></td>
      <td class="management-risk-count">${riskCount}</td><td class="management-overdue-count">${overdueCount}</td>
    </tr>`;
  }).join("");

  const ageGroups = [
    { label: "0–30 days", matches: days => days <= 30, color: "blue" },
    { label: "31–45 days", matches: days => days > 30 && days <= 45, color: "light-blue" },
    { label: "46–65 days", matches: days => days > 45 && days <= 65, color: "orange" },
    { label: "Over 65 days", matches: days => days > 65, color: "red" }
  ];
  const ageCounts = ageGroups.map(group => ({
    ...group,
    count: activeJobs.filter(job => group.matches(getDays(job))).length
  }));
  const maxAgeCount = Math.max(1, ...ageCounts.map(group => group.count));
  document.getElementById("managementAgeChart").innerHTML = ageCounts.map(group =>
    `<div class="chart-row"><span>${group.label}</span><span class="chart-track"><span class="chart-bar ${group.color}" style="width:${group.count / maxAgeCount * 100}%"></span></span><b>${group.count}</b></div>`
  ).join("");

  const reasons = new Map();
  for (const job of activeJobs) {
    if (effectiveStatus(job) !== "Overdue" && effectiveStatus(job) !== "At risk") continue;
    const reason = job.delayReason || "Not recorded";
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  const delayRows = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const maxDelayCount = Math.max(1, ...delayRows.map(([, count]) => count));
  document.getElementById("managementDelayChart").innerHTML = delayRows.length
    ? delayRows.map(([reason, count]) =>
      `<div class="chart-row"><span>${escapeHtml(reason)}</span><span class="chart-track"><span class="chart-bar purple" style="width:${count / maxDelayCount * 100}%"></span></span><b>${count}</b></div>`
    ).join("")
    : '<p class="management-empty">No delay reasons recorded.</p>';

  renderManagementTeamBoard();
}

function renderManagementTeamBoard() {
  const team = document.getElementById("managementTeamSelect").value;
  const teamJobs = jobs.filter(job => job.team === team && effectiveStatus(job) !== "Completed");
  const overdueCount = teamJobs.filter(job => effectiveStatus(job) === "Overdue").length;
  const riskCount = teamJobs.filter(job => effectiveStatus(job) === "At risk").length;
  document.getElementById("teamBoardTitle").textContent = team;
  document.getElementById("navTeamName").textContent = team;
  document.getElementById("teamBoardSummary").textContent =
    `${teamJobs.length} active jobs · ${overdueCount} overdue · ${riskCount} at risk`;
  const stages = [
    "Preparation", "Review", "Amendments", "Draft to client",
    "Client review", "Re-review", "Finalisation", "Submission"
  ];
  document.getElementById("managementBoard").innerHTML = stages.map(stage => {
    const stageJobs = teamJobs.filter(job => (job.currentStep || "Preparation") === stage);
    return `<section class="board-column"><h2>${stage}<span>${stageJobs.length}</span></h2>
      ${stageJobs.length ? stageJobs.map(job => {
        const status = effectiveStatus(job);
        const label = status === "Overdue" ? "Overdue" : status === "At risk" ? "At risk" : "On track";
        return `<article class="board-job-card">
          <span class="job-id">${escapeHtml(job.jobId || job.id)}</span>
          <strong>${escapeHtml(job.clientName || "Client")}</strong>
          <span>${escapeHtml(job.assignedName || "Unassigned")} · Day ${getDays(job)}</span>
          <span class="board-status ${statusClass(status)}">${label}</span>
        </article>`;
      }).join("") : '<p class="board-no-jobs">No active jobs</p>'}
    </section>`;
  }).join("");
}

function exportManagementJobs(scope) {
  const team = document.getElementById("managementTeamSelect").value;
  const exportJobs = (scope === "team" ? jobs.filter(job => job.team === team) : jobs)
    .map(job => [
      job.jobId || job.id, job.clientName, job.service, job.team, job.assignedName,
      job.currentStep, effectiveStatus(job), getDays(job), job.targetDays,
      job.fye, job.maReceivedAt
    ]);
  const quote = value => {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = [
    ["Job ID", "Client", "Service", "Team", "Assigned worker", "Current step", "Status", "Days open", "Target days", "FYE", "MA received"],
    ...exportJobs
  ];
  const csv = `\uFEFF${rows.map(row => row.map(quote).join(",")).join("\r\n")}`;
  const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `${scope === "team" ? team.replace(/\s+/g, "-") : "management"}-job-register.csv`;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

function isDirectorProfile() {
  return profile.role === "director" || profile.role === "management";
}

function bindWorkspaceEvents() {
document.getElementById("jobsBody")?.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action][data-job-id]");
  if (!button) return;
  const jobId = button.dataset.jobId;
  if (isLocalDevelopment && isDirectorProfile() && button.dataset.action === "route") {
    const teamSelector = document.querySelector(`[data-team="${CSS.escape(jobId)}"]`);
    const job = jobs.find(item => item.id === jobId);
    if (!job || !teamSelector?.value) return;
    job.team = teamSelector.value;
    job.service = teamService(teamSelector.value);
    job.assignedUid = "";
    job.assignedName = "Unassigned";
    job.reviewStatus = "not_requested";
    job.updatedAt = new Date();
    renderJobs();
    showMessage("Preview only: job team changed temporarily; nothing was saved to Firebase.");
    return;
  }
  if (isLocalDevelopment && profile.role === "worker" &&
      button.dataset.action === "advance" && jobId.startsWith("sample-job-")) {
    const job = jobs.find(item => item.id === jobId);
    if (!job) return;
    if (job.reviewStatus === "changes_requested" || job.currentStep === "Submission") {
      job.reviewStatus = "pending_manager_review";
      job.updatedAt = new Date();
      renderJobs();
      showMessage("Preview only: job submitted to manager for review.");
      return;
    }
    const currentStepIndex = JOB_STEPS.indexOf(job.currentStep || "Preparation");
    if (currentStepIndex < 0 || currentStepIndex >= JOB_STEPS.length - 1) {
      showMessage("This sample job cannot advance to another stage.");
      return;
    }
    job.currentStep = JOB_STEPS[currentStepIndex + 1];
    job.updatedAt = new Date();
    renderJobs();
    showMessage(`Preview only: job moved to ${job.currentStep}; nothing was saved to Firebase.`);
    return;
  }
  if (button.dataset.action === "advance") {
    await callAction(api.advanceJob, { jobId }, "Progress sent to the database.");
  } else if (button.dataset.action === "approve") {
    await callAction(api.reviewJob, { jobId, decision: "approve" }, "Job approved and completed.");
  } else if (button.dataset.action === "return") {
    await callAction(api.reviewJob, { jobId, decision: "return" }, "Job returned to the worker for follow-up.");
  } else if (button.dataset.action === "assign") {
    const assignee = document.querySelector(`[data-assignee="${CSS.escape(jobId)}"]`);
    if (!assignee?.value) {
      showMessage("Choose a worker before assigning the job.");
      return;
    }
    await callAction(api.assignJob, { jobId, workerUid: assignee.value }, "Job assigned to the selected worker.");
  } else if (button.dataset.action === "route") {
    const teamSelector = document.querySelector(`[data-team="${CSS.escape(jobId)}"]`);
    if (!teamSelector?.value) return;
    await callAction(api.assignJobTeam, { jobId, team: teamSelector.value }, `Job routed to ${teamSelector.value}.`);
  }
});

document.querySelectorAll("[data-management-view]").forEach(button => {
  button.addEventListener("click", () => {
    const showTeam = button.dataset.managementView === "team";
    document.getElementById("managementOverview").hidden = showTeam;
    document.getElementById("managementTeamBoard").hidden = !showTeam;
    document.querySelectorAll("[data-management-view]").forEach(navButton => {
      navButton.classList.toggle("is-active", navButton === button);
    });
    if (showTeam) renderManagementTeamBoard();
  });
});

document.getElementById("managementTeamSelect")?.addEventListener("change", renderManagementTeamBoard);
document.getElementById("managementTeamRows")?.addEventListener("click", event => {
  const row = event.target.closest("[data-open-team]");
  if (!row) return;
  document.getElementById("managementTeamSelect").value = row.dataset.openTeam;
  document.querySelector('[data-management-view="team"]').click();
});
document.getElementById("managementTeamRows")?.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-open-team]")) {
    event.preventDefault();
    event.target.click();
  }
});
document.querySelectorAll("[data-export]").forEach(button => {
  button.addEventListener("click", () => exportManagementJobs(button.dataset.export));
});

document.getElementById("clientTeamInput")?.addEventListener("change", updateClientCount);

document.getElementById("clientForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const team = form.get("team");
  const clientName = String(form.get("clientName") || "").trim();
  if (!team || !clientName) return;
  if (isLocalDevelopment && isDirectorProfile()) {
    if (clients.filter(client => client.team === team).length >= 250) {
      showMessage("This team has reached the 250-client limit.");
      return;
    }
    const previewClientNumber = clients.filter(client => String(client.id).startsWith("preview-client-")).length + 1;
    clients.push({ id: `preview-client-${previewClientNumber}`, name: clientName, team, previewOnly: true });
    renderClientOptions();
    formElement.reset();
    updateClientCount();
    showMessage("Preview only: client added temporarily; nothing was saved to Firebase.");
    return;
  }
  try {
    await api.createClient({ team, clientName });
    showMessage("Client added to the team portfolio.");
    formElement.reset();
    await loadClients();
  } catch (error) {
    showFailure(`Could not add client: ${error.message || "check the team portfolio limit and try again."}`, error);
  }
});

document.getElementById("jobServiceInput")?.addEventListener("change", event => {
  const service = event.currentTarget.value;
  const teamSelector = document.getElementById("jobTeamInput");
  if (teamService(teamSelector.value) !== service) {
    teamSelector.value = TEAM_NAMES.find(team => teamService(team) === service);
  }
  const selector = document.getElementById("jobClientInput");
  [...selector.options].forEach(option => {
    option.hidden = Boolean(option.value) && teamService(clients.find(client => client.id === option.value)?.team) !== service;
  });
  if (selector.selectedOptions[0]?.hidden) selector.value = "";
});

document.getElementById("jobForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const client = clients.find(item => item.id === form.get("clientId"));
  if (!client || teamService(client.team) !== form.get("service")) {
    showMessage("Choose a client whose team matches the selected service.");
    return;
  }
  if (teamService(form.get("team")) !== form.get("service")) {
    showMessage("Choose a team that matches the selected Tax or Audit service.");
    return;
  }
  if (isLocalDevelopment && isDirectorProfile()) {
    const jobNumber = jobs.filter(job => String(job.id).startsWith("preview-job-")).length + 1;
    jobs.push({
      id: `preview-job-${jobNumber}`,
      jobId: `PREVIEW-${String(jobNumber).padStart(3, "0")}`,
      clientId: client.id,
      clientName: client.name,
      service: form.get("service"),
      team: form.get("team"),
      fye: form.get("fye"),
      maReceivedAt: form.get("maReceivedAt"),
      targetDays: form.get("service") === "Tax" ? 65 : 45,
      assignedUid: "",
      assignedName: "Unassigned",
      currentStep: "Preparation",
      reviewStatus: "not_requested",
      updatedAt: new Date()
    });
    renderJobs();
    formElement.reset();
    showMessage("Preview only: job created temporarily; nothing was saved to Firebase.");
    return;
  }
  const created = await callAction(api.createJob, {
    clientId: client.id,
    service: form.get("service"),
    team: form.get("team"),
    fye: form.get("fye"),
    maReceivedAt: form.get("maReceivedAt")
  }, "Job created and assigned to the selected team.");
  if (created) formElement.reset();
});

for (const id of ["staffSearch", "teamFilter", "serviceFilter", "statusFilter"]) {
  document.getElementById(id)?.addEventListener(id === "staffSearch" ? "input" : "change", renderJobs);
}

document.getElementById("signOutButton").addEventListener("click", async () => {
  try {
    if (unsubscribeJobs) unsubscribeJobs();
    await signOut(auth);
    window.location.replace("login.html");
  } catch (error) {
    showFailure("Could not sign out. Please check your connection and try again.", error);
  }
});
}

async function loadStaff() {
  if (profile.role === "worker") return;
  try {
    const snapshot = await getDocs(query(collection(db, "users"), where("role", "==", "worker")));
    staff = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  } catch (error) {
    showFailure("Could not load worker accounts. Check Firestore access rules.", error);
  }
}

async function loadClients() {
  if (profile.role !== "director") return;
  try {
    const snapshot = await getDocs(collection(db, "clients"));
    clients = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderClientOptions();
    updateClientCount();
    document.getElementById("jobServiceInput").dispatchEvent(new Event("change"));
  } catch (error) {
    document.getElementById("clientCountNote").textContent =
      "Could not read clients from Firestore. Check the director role and Firestore rules.";
    showFailure("Could not load client records. Check Firestore access rules.", error);
  }
}

function watchJobs() {
  const jobsQuery = profile.role === "worker"
    ? query(collection(db, "jobs"), where("assignedUid", "==", currentUser.uid))
    : collection(db, "jobs");
  unsubscribeJobs = onSnapshot(jobsQuery, snapshot => {
    jobs = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    if (isLocalDevelopment && jobs.length === 0 &&
        (isDirectorProfile() || profile.role === "manager" || profile.role === "worker")) {
      jobs = profile.role === "management"
        ? managementSampleJobs()
        : directorSampleJobs()
          .filter(job => profile.role !== "worker" || job.team === profile.team)
          .map(job => profile.role === "worker" ? {
            ...job,
            assignedUid: currentUser.uid,
            assignedName: profile.displayName || currentUser.displayName || currentUser.email
          } : job);
      const subtitle = document.getElementById("tableSubtitle");
      if (subtitle) subtitle.textContent =
        profile.role === "management"
          ? "Sample management report · preview only, not saved to Firebase."
          : profile.role === "worker"
          ? "Sample jobs for your team · preview only, not saved to Firebase."
          : "Sample job register for client preview · not saved to Firebase.";
    } else {
      const subtitle = document.getElementById("tableSubtitle");
      if (subtitle) subtitle.textContent = "Live records from Firestore.";
    }
    renderJobs();
  }, error => {
    document.getElementById("tableSubtitle").textContent =
      "Could not read Firestore jobs. Check the director role and Firestore rules.";
    showFailure("Could not load live jobs. Check Firestore rules and database setup.", error);
  });
}

async function callAction(callable, payload, successMessage) {
  try {
    await callable(payload);
    showMessage(successMessage);
    return true;
  } catch (error) {
    console.error("Could not update the job register:", error);
    const details = error.code === "functions/not-found"
      ? "Deploy the Firebase Functions before using this action."
      : error.message || "Check your role permissions and try again.";
    showMessage(`Update failed: ${details}`);
    return false;
  }
}

function redirectToLogin(error) {
  window.location.replace(`login.html${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

window.setTimeout(() => {
  if (document.body.classList.contains("auth-ready")) return;
  const loading = document.getElementById("workspaceLoading");
  if (!loading) return;
  loading.innerHTML = `<div class="workspace-loading-card">
    <strong>Could not load the role workspace</strong>
    <p>Check that this Firebase account has a <code>users/{UID}</code> profile with role <code>director</code>, and that Firestore rules allow the account to read it.</p>
    <p><a href="login.html">Return to sign in</a></p>
  </div>`;
}, 10000);

onAuthStateChanged(auth, async user => {
  if (!user) {
    redirectToLogin("");
    return;
  }
  currentUser = user;
  if (!user.emailVerified && !isLocalDevelopment) {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Could not clear the unverified session:", error);
    }
    redirectToLogin("verify-email");
    return;
  }

  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    if (!snapshot.exists()) {
      redirectToLogin("profile-unavailable");
      return;
    }
    profile = snapshot.data();
    const role = String(profile.role || "").toLowerCase();
    if (profile.email?.toLowerCase() !== user.email?.toLowerCase() ||
        !["worker", "manager", "director", "management"].includes(role)) {
      redirectToLogin("profile-unavailable");
      return;
    }
    profile.role = role;
    const requestedPage = window.location.pathname.split("/").pop();
    if (requestedPage !== ROLE_PAGES[role]) {
      window.location.replace(ROLE_PAGES[role]);
      return;
    }
    if (role === "manager" && !TEAM_NAMES.includes(profile.team)) {
      redirectToLogin("team-dashboard-unavailable");
      return;
    }
    if (role === "manager" && profile.service !== teamService(profile.team)) {
      redirectToLogin("team-dashboard-unavailable");
      return;
    }
    if (role === "worker" && (!TEAM_NAMES.includes(profile.team) || profile.service !== teamService(profile.team))) {
      redirectToLogin("profile-unavailable");
      return;
    }

    setupRoleInterface();
    populateStaticFilters();
    bindWorkspaceEvents();
    if (isLocalDevelopment && !isDirectorProfile()) {
      document.querySelectorAll("#clientForm input, #clientForm select, #clientForm button, #jobForm input, #jobForm select, #jobForm button")
        .forEach(control => { control.disabled = true; });
    }
    if (isLocalDevelopment && (isDirectorProfile() || role === "manager")) {
      jobs = role === "management" ? managementSampleJobs() : directorSampleJobs();
      const subtitle = document.getElementById("tableSubtitle");
      if (subtitle) subtitle.textContent = role === "management"
        ? "Sample management report · preview only, not saved to Firebase."
        : "Sample job register for client preview · not saved to Firebase.";
    }
    renderJobs();
    watchJobs();
    document.body.classList.add("auth-ready");
    void loadStaff();
    void loadClients();
  } catch (error) {
    showFailure("Could not load your account profile.", error);
    redirectToLogin("profile-unavailable");
  }
}, error => {
  showFailure("Firebase authentication state failed.", error);
  redirectToLogin("profile-unavailable");
});
