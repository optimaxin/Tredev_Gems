import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
} from "firebase/auth";

const config = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

export const FIREBASE_ENABLED = !!(config.apiKey && config.projectId && config.appId);

let _app = null;
let _auth = null;

export function fbAuth() {
  if (!FIREBASE_ENABLED) return null;
  if (!_app) _app = getApps().length ? getApps()[0] : initializeApp(config);
  if (!_auth) _auth = getAuth(_app);
  return _auth;
}

// Verifier lifecycle:
// A RecaptchaVerifier is single-shot in practice — once its token has been consumed
// (or the internal iframe times out), reusing it produces `auth/captcha-check-failed`.
// So we ALWAYS destroy the previous verifier and create a fresh one before each send.
let _verifier = null;

export function clearRecaptcha() {
  try { _verifier?.clear(); } catch (_) {}
  _verifier = null;
  // Also wipe any leftover children Firebase injected into the container so the
  // next verifier renders into a clean host element.
  try {
    const host = document.getElementById("gemora-recaptcha");
    if (host) host.innerHTML = "";
  } catch (_) {}
}

export function ensureRecaptcha(containerId = "gemora-recaptcha") {
  if (!FIREBASE_ENABLED) return null;
  // Always start fresh — this is the fix for auth/captcha-check-failed on retries.
  clearRecaptcha();
  const auth = fbAuth();
  _verifier = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
  return _verifier;
}

/** Google sign-in via Firebase popup. Returns the Firebase ID token for the backend
 *  to verify (POST /auth/google). Replaces the old Emergent OAuth redirect. */
export async function signInWithGoogle() {
  if (!FIREBASE_ENABLED) throw new Error("Firebase is not configured");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(fbAuth(), provider);
  return cred.user.getIdToken();
}

export { signInWithPhoneNumber };
