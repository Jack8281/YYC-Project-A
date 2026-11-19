import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const AUTH_EMULATOR = "127.0.0.1:9099";
const FIRESTORE_EMULATOR = "127.0.0.1:8080";
const PROJECT_ID = "login-details-dea33";
const TEST_PASSWORD = "LocalTest123!";

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== AUTH_EMULATOR ||
    process.env.FIRESTORE_EMULATOR_HOST !== FIRESTORE_EMULATOR) {
  throw new Error(
    "Refusing to seed: start the local Auth and Firestore emulators and set both emulator host variables first."
  );
}

if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID) {
  throw new Error(`Project ID mismatch. Start the emulator with --project ${PROJECT_ID}.`);
}

initializeApp({ projectId: PROJECT_ID });

const auth = getAuth();
const db = getFirestore();
const testAccounts = [
  {
    email: "manager@gmail.com",
    displayName: "Local Management Tester",
    role: "management"
  },
  {
    email: "director@gmail.com",
    displayName: "Local Director Tester",
    role: "director"
  },
  {
    email: "worker@gmail.com",
    displayName: "Local Worker Tester",
    role: "worker",
    service: "Tax",
    team: "Tax 11"
  }
];

for (const account of testAccounts) {
  let user;
  try {
    user = await auth.getUserByEmail(account.email);
    user = await auth.updateUser(user.uid, {
      password: TEST_PASSWORD,
      displayName: account.displayName,
      emailVerified: false
    });
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({
      email: account.email,
      password: TEST_PASSWORD,
      displayName: account.displayName,
      emailVerified: false
    });
  }

  const profile = {
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    allowUnverifiedTesting: true
  };
  if (account.service) profile.service = account.service;
  if (account.team) profile.team = account.team;

  await db.collection("users").doc(user.uid).set(profile);
  console.log(`Seeded local ${account.role} account: ${account.email}`);
}

console.log(`Local emulator password for all three accounts: ${TEST_PASSWORD}`);
