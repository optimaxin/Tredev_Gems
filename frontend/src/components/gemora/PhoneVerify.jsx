import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { FIREBASE_ENABLED, fbAuth, ensureRecaptcha, clearRecaptcha, warmRecaptcha, signInWithPhoneNumber } from "@/lib/firebase";
import { detectCountry } from "@/lib/currency";
import { COUNTRY_CODES } from "@/lib/countryCodes";
import { X, Phone, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import AsyncButton from "@/components/gemora/AsyncButton";

/**
 * Firebase Phone Auth verification. onVerified(phone, otp_verification_token, session?) fires on success.
 *
 * There is NO mock/dev fallback anywhere in this component — if Firebase is not
 * configured or the SMS flow fails, we show the real error to the user so
 * misconfigurations cannot silently degrade into a fake login.
 */
export default function PhoneVerify({ open = true, onClose, onVerified, prefillPhone = "" }) {
  const [phone, setPhone] = useState(prefillPhone);
  const [dial, setDial] = useState("91");
  const [step, setStep] = useState(1);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cdRef = useRef(null);
  // The in-flight (or already settled) signInWithPhoneNumber promise, NOT a
  // resolved confirmation: the OTP screen goes up the instant the user clicks,
  // so verify() awaits this instead of a value that may not exist yet.
  const sendTaskRef = useRef(null);
  // Whether any send has ever succeeded — decides if a failure should bounce the
  // user back to the number screen or just surface as a toast on the OTP screen.
  const sentOkRef = useRef(false);

  useEffect(() => () => { if (cdRef.current) clearInterval(cdRef.current); clearRecaptcha(); }, []);

  // Build + solve the reCAPTCHA while the user is still typing their number, so
  // "Send OTP" only pays for the SMS dispatch itself. See warmRecaptcha().
  // Keyed on `open` because the container div only exists once the panel is
  // rendered — warming before that would find no host element and no-op.
  useEffect(() => { if (open) warmRecaptcha("gemora-recaptcha"); }, [open]);

  // Default the country picker to the visitor's actual country instead of
  // always assuming India — the user can still change it manually.
  useEffect(() => {
    let cancelled = false;
    detectCountry().then((iso) => {
      if (cancelled) return;
      const match = COUNTRY_CODES.find((c) => c.iso === iso);
      if (match) setDial(match.dial);
    });
    return () => { cancelled = true; };
  }, []);

  const startCooldown = () => {
    setCooldown(30);
    cdRef.current = setInterval(() => setCooldown((c) => c <= 1 ? (clearInterval(cdRef.current), 0) : c - 1), 1000);
  };

  const normalize = (raw) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.startsWith(dial) && digits.length > 10) return `+${digits}`;
    return `+${dial}${digits}`;
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

  /**
   * Optimistic send: the OTP entry screen appears on the click, and the SMS
   * dispatch continues in the background with no spinner.
   *
   * This costs the user nothing real — the code cannot be typed before the SMS
   * physically arrives, which is always well after the dispatch call resolves.
   * So the round-trip is spent on a screen the user is reading anyway instead of
   * on a blocking loader. Deliberately NOT async: it must return immediately.
   */
  const send = () => {
    if (!FIREBASE_ENABLED) {
      toast.error("Phone auth isn't configured. Please contact support.");
      return;
    }
    const p = normalize(phone);
    const total = p.replace(/\D/g, "").length;
    if (total < dial.length + 6 || total > 15) { toast.error("Enter a valid mobile number"); return; }

    // — optimistic UI: everything the user sees happens now —
    setStep(2);
    setCode("");
    startCooldown();

    const t0 = performance.now();
    const task = (async () => {
      const auth = fbAuth();
      const verifier = await ensureRecaptcha("gemora-recaptcha");
      const tCaptcha = performance.now();
      const conf = await signInWithPhoneNumber(auth, p, verifier);
      console.info(`[PhoneVerify] send: captcha ${Math.round(tCaptcha - t0)}ms, sms ${Math.round(performance.now() - tCaptcha)}ms, total ${Math.round(performance.now() - t0)}ms`);
      return conf;
    })();
    sendTaskRef.current = task;

    task.then(() => {
      sentOkRef.current = true;
      toast.success(`OTP sent to ${p}`);
      // That token is spent. Rebuild the next one in the background so
      // "Resend OTP" is instant too instead of paying the full chain again.
      clearRecaptcha();
      warmRecaptcha("gemora-recaptcha");
    }).catch((e) => {
      console.error("[PhoneVerify] send OTP failed:", e);
      clearRecaptcha();
      warmRecaptcha("gemora-recaptcha");
      // A superseded attempt (user already hit Resend) must not clobber the
      // newer one's UI state.
      if (sendTaskRef.current !== task) return;
      toast.error(fbErrorMessage(e));
      // Nothing was ever sent, so the OTP screen is a dead end — walk it back.
      // On a failed *resend* the earlier code is still valid, so stay put.
      if (!sentOkRef.current) {
        setStep(1);
        if (cdRef.current) clearInterval(cdRef.current);
        setCooldown(0);
      }
    });
  };

  const verify = async () => {
    if (!code || code.length < 4) { toast.error("Enter the OTP"); return; }
    if (!sendTaskRef.current) { toast.error("Please tap Send OTP first."); return; }
    setVerifying(true);
    const t0 = performance.now();
    try {
      // Settles the background send first. In practice it resolved long ago —
      // the user had to wait for the SMS to arrive to get here — so this is a
      // no-op await, but it makes the optimistic path correct even if someone
      // pastes a code the instant the screen appears.
      const confirmation = await sendTaskRef.current;
      const tSend = performance.now();
      const cred = await confirmation.confirm(code);
      const tConfirm = performance.now();
      const idToken = await cred.user.getIdToken();
      const tToken = performance.now();
      const { data } = await api.post("/auth/firebase-verify", { id_token: idToken });
      console.info(`[PhoneVerify] verify: awaitSend ${Math.round(tSend - t0)}ms, confirm ${Math.round(tConfirm - tSend)}ms, idToken ${Math.round(tToken - tConfirm)}ms, backend ${Math.round(performance.now() - tToken)}ms, total ${Math.round(performance.now() - t0)}ms`);
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

      {step === 1 ? (
        <>
          <label className="block mt-6">
            <div className="text-xs text-ink-muted mb-1">Mobile number</div>
            <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
              <select
                value={dial}
                onChange={(e) => setDial(e.target.value)}
                data-testid="phone-verify-country"
                className="px-2 py-3 bg-cream text-sm text-ink-soft border-r border-gold/30 font-mono outline-none max-w-[6.5rem]"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.iso} value={c.dial}>{c.iso} +{c.dial}</option>
                ))}
              </select>
              <input
                value={phone.replace(/\D/g, "")}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 12))}
                data-testid="phone-verify-input"
                inputMode="tel"
                placeholder={dial === "91" ? "10-digit mobile" : "Mobile number"}
                className="flex-1 px-3 py-3 outline-none min-w-0"
                autoFocus
              />
            </div>
          </label>
          {/* No loading state by design — this advances to the OTP screen
              synchronously and the SMS dispatch runs in the background. */}
          <AsyncButton onClick={send} data-testid="phone-verify-send" className="mt-5 w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift disabled:opacity-50">
            Send OTP
          </AsyncButton>
        </>
      ) : (
        <>
          <div className="mt-6 text-sm text-ink-soft">OTP sent to <span className="font-mono">{normalize(phone)}</span>
            <button onClick={() => {
              setStep(1);
              sendTaskRef.current = null;
              sentOkRef.current = false;
              if (cdRef.current) clearInterval(cdRef.current);
              setCooldown(0);
              // Going back means a fresh number, so a fresh token — start
              // building it now rather than on the next click.
              clearRecaptcha();
              warmRecaptcha("gemora-recaptcha");
            }} className="ml-2 text-maroon underline text-xs">edit</button>
          </div>
          <label className="block mt-5">
            <div className="text-xs text-ink-muted mb-1">Enter the 6-digit code</div>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} data-testid="phone-verify-otp-input"
              inputMode="numeric" maxLength={6} autoFocus
              className="w-full gold-line px-4 py-3 outline-none focus:border-maroon text-center font-mono text-2xl tracking-[0.5em]" />
          </label>
          <AsyncButton onClick={verify} loading={verifying} loadingText="Verifying…" data-testid="phone-verify-submit" className="mt-5 w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift disabled:opacity-50">
            <ShieldCheck size={16} weight="duotone" /> Verify OTP
          </AsyncButton>
          <AsyncButton onClick={send} disabled={cooldown > 0} data-testid="phone-verify-resend" className="mt-3 w-full text-xs text-ink-muted hover:text-maroon disabled:opacity-50">
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
          </AsyncButton>
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
