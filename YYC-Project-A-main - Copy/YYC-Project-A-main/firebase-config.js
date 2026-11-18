import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyBcXQGqQsspsd-gXPerhHQas23-9atSOtc",
  authDomain: "login-details-dea33.firebaseapp.com",
  projectId: "login-details-dea33",
  storageBucket: "login-details-dea33.firebasestorage.app",
  messagingSenderId: "385103346065",
  appId: "1:385103346065:web:c1f2d6f2efb2c234e68230"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
