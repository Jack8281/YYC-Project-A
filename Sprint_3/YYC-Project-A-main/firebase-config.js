import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { connectAuthEmulator, getAuth } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { connectFirestoreEmulator, getFirestore } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { connectFunctionsEmulator, getFunctions } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyBcXQGqQsspsd-gXPerhHQas23-9atSOtc",
  authDomain: "login-details-dea33.firebaseapp.com",
  projectId: "login-details-dea33",
  storageBucket: "login-details-dea33.firebasestorage.app",
  messagingSenderId: "385103346065",
  appId: "1:385103346065:web:c1f2d6f2efb2c234e68230"
};

export const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
const urlParams = new URLSearchParams(window.location.search);
export const useFirebaseEmulators = isLocalDevelopment &&
  urlParams.get("emulator") === "true" && urlParams.get("cloud") !== "true";

const app = useFirebaseEmulators
  ? initializeApp(firebaseConfig, "yyc-local-emulator")
  : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

if (useFirebaseEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
