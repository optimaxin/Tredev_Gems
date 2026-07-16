import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { FIREBASE_ENABLED, fbAuth, ensureRecaptcha, clearRecaptcha, signInWithPhoneNumber } from "@/lib/firebase";
import { X, Phone, ShieldCheck, WarningCircle } from "@phosphor-icons/react";

/**
 * Firebase Phone Auth verification. onVerified(phone, otp_verification_token, session?) fires on success.
 *
 * There is NO mock/dev fallback anywhere in this component — if Firebase is not
 * configured or the SMS flow fails, we show the real error to the user so
 * misconfigurations cannot silently degrade into a fake login.
 */
export default function PhoneVerify({ open = true, onClose, onVerified, prefillPhone = "" }) {
  const [phone, setPhone] = useState(prefillPhone);
  const [step, setStep] = useState(1);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [confirmation, setConfirmation] = useState(null);
  const cdRef = useRef(null);

  useEffect(() => () => { if (cdRef.current) clearInterval(cdRef.current); clearRecaptcha(); }, []);

  const startCooldown = () => {
    setCooldown(30);
    cdRef.current = setInterval(() => setCooldown((c) => c <= 1 ? (clearInterval(cdRef.current), 0) : c - 1), 1000);
  };

  const normalize = (raw) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
    if (digits.length === 10) return `+91${digits}`;
    return `+${digits}`;
  };

  // Human-readable messages for common Firebase auth error codes.
  const fbErrorMessage = (e) => {
    const code = e?.code || "";
    const map = {
      "auth/invalid-phone-number": "That phone number doesn't look right. Please check the country code and digits.",
      "auth/missing-phone-number": "Please enter your mobile number.",
      "auth/quota-exceeded": "Daily SMS quota reached on this project. Please try again tomorrow or contact support.",
      "auth/too-many-requests": "Too many attempts from this device. Please wait a while and try again.",
      "auth/captcha-check-failed": "Bot check failed. Please refresh the page and try again.",
      "auth/invalid-app-credential": "Bot check token is invalid — likely because this domain isn't on Firebase's authorized list. Please contact support.",
      "auth/network-request-failed": "Network error. Check your internet connection and retry.",
      "auth/operation-not-allowed": "Phone sign-in is disabled for this project. Please contact support.",
      "auth/invalid-verification-code": "That code is incorrect. Please re-check the SMS and try again.",
      "auth/code-expired": "That code has expired. Please tap Resend OTP.",
      "auth/session-expired": "The code has expired. Please request a new OTP.",
      "auth/unauthorized-domain": "This site's domain isn't authorized for Firebase phone auth. Please contact support.",
    };
    if (map[code]) return `${map[code]} (${code})`;
    return e?.message ? `${e.message}${code ? ` (${code})` : ""}` : "Something went wrong sending the OTP.";
  };

  const send = async () => {
    if (!FIREBASE_ENABLED) {
      toast.error("Phone auth isn't configured. Please contact support.");
      return;
    }
    const p = normalize(phone);
    if (p.replace(/\D/g, "").length < 12) { toast.error("Enter a valid 10-digit mobile"); return; }
    setSending(true);
    try {
      const auth = fbAuth();
      const verifier = ensureRecaptcha("gemora-recaptcha");
      const conf = await signInWithPhoneNumber(auth, p, verifier);
      setConfirmation(conf);
      setStep(2);
      startCooldown();
      toast.success(`OTP sent to ${p}`);
    } catch (e) {
      console.error("[PhoneVerify] send OTP failed:", e);
      toast.error(fbErrorMessage(e));
      clearRecaptcha();
    } finally { setSending(false); }
  };

  const verify = async () => {
    if (!code || code.length < 4) { toast.error("Enter the OTP"); return; }
    if (!confirmation) { toast.error("Please tap Send OTP first."); return; }
    setVerifying(true);
    try {
      const cred = await confirmation.confirm(code);
      const idToken = await cred.user.getIdToken();
      const { data } = await api.post("/auth/firebase-verify", { id_token: idToken });
      toast.success("Phone verified");
      onVerified?.(data.phone, data.otp_verification_token, data.session);
    } catch (e) {
      console.error("[PhoneVerify] verify OTP failed:", e);
      const detail = e?.response?.data?.detail;
      toast.error(detail || fbErrorMessage(e));
    } finally { setVerifying(false); }
  };

  if (!open) return null;

  // Hard error state — no silent fallback.
  if (!FIREBASE_ENABLED) {
    return (
      <div className="gold-line-strong bg-ivory p-8 max-w-md w-full" data-testid="phone-verify-disabled">
        <div className="flex items-center gap-2 text-maroon-deep">
          <WarningCircle size={22} weight="duotone" />
          <span className="font-serifd text-xl">Phone verification unavailable</span>
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          Firebase Phone Auth is not configured on this deployment. Please contact Tredev support to complete your sign-up or sign-in.
        </p>
        <p className="mt-3 text-[11px] text-ink-muted">
          (Administrator: set the <code className="font-mono">REACT_APP_FIREBASE_*</code> environment variables and redeploy.)
        </p>
      </div>
    );
  }

  const inner = (
    <div className="gold-line-strong bg-ivory p-8 max-w-md w-full relative" data-testid="phone-verify-panel">
      {onClose && (
        <button onClick={onClose} className="absolute top-4 right-4 text-ink-muted hover:text-maroon" data-testid="phone-verify-close">
          <X size={18} />
        </button>
      )}
      <div className="flex items-center gap-2 text-maroon-deep">
        <Phone size={22} weight="duotone" />
        <span className="font-serifd text-xl">Verify your phone</span>
      </div>
      <p className="text-xs text-ink-muted mt-1">Google Firebase will send an SMS with a 6-digit code.</p>

      {step === 1 ? (
        <>
          <label className="block mt-6">
            <div className="text-xs text-ink-muted mb-1">Mobile number</div>
            <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
              <span className="px-3 py-3 bg-cream text-sm text-ink-soft border-r border-gold/30 font-mono">+91</span>
              <input
                value={phone.replace(/^\+91/, "")}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                data-testid="phone-verify-input"
                inputMode="tel"
                placeholder="10-digit mobile"
                className="flex-1 px-3 py-3 outline-none"
                autoFocus
              />
            </div>
          </label>
          <button onClick={send} disabled={sending} data-testid="phone-verify-send" className="mt-5 w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift disabled:opacity-50">
            {sending ? "Sending…" : "Send OTP"}
          </button>
        </>
      ) : (
        <>
          <div className="mt-6 text-sm text-ink-soft">OTP sent to <span className="font-mono">{normalize(phone)}</span>
            <button onClick={() => { setStep(1); setConfirmation(null); clearRecaptcha(); }} className="ml-2 text-maroon underline text-xs">edit</button>
          </div>
          <label className="block mt-5">
            <div className="text-xs text-ink-muted mb-1">Enter the 6-digit code</div>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} data-testid="phone-verify-otp-input"
              inputMode="numeric" maxLength={6} autoFocus
              className="w-full gold-line px-4 py-3 outline-none focus:border-maroon text-center font-mono text-2xl tracking-[0.5em]" />
          </label>
          <button onClick={verify} disabled={verifying} data-testid="phone-verify-submit" className="mt-5 w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift disabled:opacity-50">
            <ShieldCheck size={16} weight="duotone" /> {verifying ? "Verifying…" : "Verify OTP"}
          </button>
          <button onClick={send} disabled={cooldown > 0 || sending} data-testid="phone-verify-resend" className="mt-3 w-full text-xs text-ink-muted hover:text-maroon disabled:opacity-50">
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
          </button>
        </>
      )}
      {/* Firebase invisible reCAPTCHA anchor */}
      <div id="gemora-recaptcha" />
    </div>
  );

  if (onClose) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-maroon-deep/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative">{inner}</div>
      </div>
    );
  }
  return inner;
}
