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
// So each send gets a freshly built+solved verifier — but it is built AHEAD of the
// click, not during it (see warmRecaptcha below).
let _verifier = null;
let _warm = null; // in-flight/settled warm-up promise for the current verifier

export function clearRecaptcha() {
  try { _verifier?.clear(); } catch (_) {}
  _verifier = null;
  _warm = null;
  // Also wipe any leftover children Firebase injected into the container so the
  // next verifier renders into a clean host element.
  try {
    const host = document.getElementById("gemora-recaptcha");
    if (host) host.innerHTML = "";
  } catch (_) {}
}

/**
 * Pre-build the invisible reCAPTCHA *before* the user clicks "Send OTP".
 *
 * Measured on the live site, doing this lazily at click time costs ~10s of dead
 * wait, none of which involves our own backend:
 *     GET recaptchaParams        ~0.5s
 *     load recaptcha script      ~2.1s
 *     render invisible widget    ~0.1s
 *     execute() / solve token    ~2-7s   ← the dominant term, highly variable
 * …and only then does Firebase send the SMS.
 *
 * Every one of those legs can happen while the user is still typing their number.
 * verify() caches its result inside the grecaptcha widget, so when Firebase later
 * calls verify() itself during signInWithPhoneNumber it hits grecaptcha.getResponse()
 * and returns the already-solved token synchronously — the click then costs only
 * the actual sendVerificationCode round-trip.
 *
 * Best-effort by design: any failure here just leaves the normal lazy path to run
 * at click time, exactly as before.
 */
export function warmRecaptcha(containerId = "gemora-recaptcha") {
  if (!FIREBASE_ENABLED) return Promise.resolve(null);
  if (_warm) return _warm;
  _warm = (async () => {
    if (typeof document === "undefined" || !document.getElementById(containerId)) return null;
    _verifier = new RecaptchaVerifier(fbAuth(), containerId, { size: "invisible" });
    await _verifier.render();          // script download + widget render
    await _verifier.verify();          // solve the token up front; cached by grecaptcha
    return _verifier;
  })();
  // A failed warm-up must not poison later attempts — reset so the click path
  // can build a verifier from scratch.
  _warm.catch(() => { _verifier = null; _warm = null; });
  return _warm;
}

/** Verifier for an imminent send — uses the pre-warmed one when available. */
export async function ensureRecaptcha(containerId = "gemora-recaptcha") {
  if (!FIREBASE_ENABLED) return null;
  const warmed = await warmRecaptcha(containerId).catch(() => null);
  if (warmed) return warmed;
  // Warm-up didn't happen (or failed) — fall back to the original lazy behaviour.
  clearRecaptcha();
  _verifier = new RecaptchaVerifier(fbAuth(), containerId, { size: "invisible" });
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
