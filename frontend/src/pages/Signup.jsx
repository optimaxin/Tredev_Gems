import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { GoogleLogo, ShieldCheck, CheckCircle } from "@phosphor-icons/react";
import PhoneVerify from "@/components/gemora/PhoneVerify";
import AuthVisualPanel from "@/components/gemora/AuthVisualPanel";
import AsyncButton from "@/components/gemora/AsyncButton";
import { api } from "@/lib/api";

const fieldVariants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };
const formVariants = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };

export default function Signup() {
  const { refresh, googleLogin } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const dest = location.state?.from || "/account";

  const [step, setStep] = useState(1); // 1 = verify phone, 2 = account details
  const [phone, setPhone] = useState("");
  const [otpToken, setOtpToken] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", wa_optin: true });
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const [agreed, setAgreed] = useState(false);

  const set = (k) => (e) => setForm((x) => ({ ...x, [k]: e.target.value }));
  const checkEmail = (v) => setEmailErr(v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "Enter a valid email address" : "");

  const onVerified = (p, token) => {
    setPhone(p); setOtpToken(token); setStep(2);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!agreed) { toast.error("Please agree to the Terms & Conditions and Privacy Policy to continue"); return; }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/signup", {
        name: form.name, email: form.email, password: form.password,
        phone, otp_verification_token: otpToken, wa_optin: form.wa_optin,
      });
      localStorage.setItem("gemora_jwt", data.token);
      await refresh();
      toast.success("Welcome to Tredev");
      nav(dest);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  // Google sign-up == Google sign-in: Firebase popup -> ID token -> our JWT.
  // /auth/google creates the account if the email is new.
  const google = async () => {
    if (!agreed) { toast.error("Please agree to the Terms & Conditions and Privacy Policy to continue"); return; }
    setGoogleLoading(true);
    try {
      await googleLogin();
      nav(dest);
    } catch (err) {
      if (err?.code === "auth/popup-closed-by-user") return;
      toast.error(err?.response?.data?.detail || err?.message || "Google sign-in failed");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="relative overflow-hidden px-4 sm:px-6 py-12 md:py-16">
      <div className="absolute inset-0 geom-bg pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="relative mx-auto max-w-4xl grid lg:grid-cols-[1.05fr_1fr] gold-line-strong overflow-hidden bg-ivory shadow-[0_30px_80px_-30px_rgba(78,31,38,0.35)]"
      >
        <div className="order-2 lg:order-1 p-8 sm:p-10 md:p-12">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Join the vault</div>
            <h1 className="font-display text-4xl text-ink mt-1">Create your account</h1>
          </div>

          <div className="mt-6 gold-line bg-cream p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                data-testid="signup-agree-terms"
                className="mt-0.5 w-4 h-4 accent-maroon shrink-0"
              />
              <span className="text-xs text-ink-soft leading-relaxed">
                I agree to Tredev's{" "}
                <Link to="/terms-and-conditions" target="_blank" rel="noreferrer" className="text-maroon underline decoration-gold-soft">Terms &amp; Conditions</Link>
                {" "}and{" "}
                <Link to="/privacy-policy" target="_blank" rel="noreferrer" className="text-maroon underline decoration-gold-soft">Privacy Policy</Link>.
              </span>
            </label>
          </div>

          {/* Stepper */}
          <div className="mt-8 flex items-center justify-center gap-3 text-xs">
            <div className={`flex items-center gap-2 ${step >= 1 ? "text-maroon-deep" : "text-ink-muted"}`}>
              <span className={`w-6 h-6 flex items-center justify-center border ${step >= 1 ? "border-maroon bg-maroon text-ivory" : "border-gold/40"}`}>
                {step > 1 ? <CheckCircle size={14} weight="fill" className="seal-pop" /> : "1"}
              </span>
              <span className="uppercase tracking-widest">Verify phone</span>
            </div>
            <div className="relative w-8 h-px bg-gold/40 overflow-hidden">
              <motion.div className="absolute inset-y-0 left-0 brand-gradient" initial={{ width: 0 }}
                animate={{ width: step >= 2 ? "100%" : "0%" }} transition={{ duration: 0.5, ease: "easeOut" }} />
            </div>
            <div className={`flex items-center gap-2 ${step >= 2 ? "text-maroon-deep" : "text-ink-muted"}`}>
              <span className={`w-6 h-6 flex items-center justify-center border ${step >= 2 ? "border-maroon bg-maroon text-ivory" : "border-gold/40"}`}>2</span>
              <span className="uppercase tracking-widest">Your details</span>
            </div>
          </div>

          <div className="mt-8">
            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.div key="step1" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                  <PhoneVerify onVerified={onVerified} />
                  <div className="relative py-4 text-center text-[11px] text-ink-muted">
                    <span className="bg-ivory px-3 relative z-10">or</span>
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-gold/30" />
                  </div>
                  <AsyncButton
                    type="button"
                    onClick={google}
                    loading={googleLoading}
                    loadingText="Signing in…"
                    data-testid="signup-google"
                    disabled={!agreed}
                    className="w-full border border-maroon text-maroon py-3 text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-maroon hover:text-ivory transition-colors"
                  >
                    <GoogleLogo size={16} weight="bold" /> Continue with Google
                  </AsyncButton>
                  <p className="mt-3 text-[11px] text-ink-muted text-center">
                    Google users still need to verify a phone number after signing in.
                  </p>
                </motion.div>
              ) : (
                <motion.form
                  key="step2"
                  onSubmit={submit}
                  variants={formVariants}
                  initial="hidden"
                  animate="show"
                  className="gold-line bg-ivory p-8 space-y-4"
                >
                  <motion.div variants={fieldVariants} className="flex items-center gap-2 text-verified text-xs mb-2">
                    <ShieldCheck size={14} weight="duotone" /> Phone verified · <span className="font-mono">{phone}</span>
                    <button type="button" onClick={() => setStep(1)} className="ml-auto text-ink-muted underline">change</button>
                  </motion.div>
                  <motion.label variants={fieldVariants} className="block">
                    <div className="text-xs text-ink-muted mb-1">Full name</div>
                    <input data-testid="signup-name" required value={form.name} onChange={set("name")}
                      className="w-full gold-line px-4 py-3 outline-none transition-shadow focus:border-maroon focus:ring-2 focus:ring-gold/30" autoFocus />
                  </motion.label>
                  <motion.label variants={fieldVariants} className="block">
                    <div className="text-xs text-ink-muted mb-1">Email</div>
                    <input data-testid="signup-email" required value={form.email}
                      onChange={(e) => { set("email")(e); if (emailErr) checkEmail(e.target.value); }}
                      onBlur={(e) => checkEmail(e.target.value)} type="email"
                      className={`w-full px-4 py-3 outline-none transition-shadow focus:ring-2 ${emailErr ? "border border-revoked focus:ring-revoked/20" : "gold-line focus:border-maroon focus:ring-gold/30"}`} />
                    {emailErr && <div role="alert" className="mt-1 text-xs text-revoked">{emailErr}</div>}
                  </motion.label>
                  <motion.label variants={fieldVariants} className="block">
                    <div className="text-xs text-ink-muted mb-1">Password</div>
                    <input data-testid="signup-password" required value={form.password} onChange={set("password")} type="password" minLength={6}
                      className="w-full gold-line px-4 py-3 outline-none transition-shadow focus:border-maroon focus:ring-2 focus:ring-gold/30" />
                    {form.password.length > 0 && (
                      <div className={`mt-1 flex items-center gap-1 text-xs ${form.password.length >= 6 ? "text-verified" : "text-ink-muted"}`}>
                        {form.password.length >= 6
                          ? <><CheckCircle size={12} weight="fill" /> Looks good</>
                          : `${6 - form.password.length} more character${6 - form.password.length === 1 ? "" : "s"} needed`}
                      </div>
                    )}
                  </motion.label>
                  <motion.label variants={fieldVariants} className="flex items-start gap-3 mt-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={form.wa_optin}
                      onChange={(e) => setForm({ ...form, wa_optin: e.target.checked })}
                      data-testid="signup-wa-optin"
                      className="mt-1 w-4 h-4 accent-maroon"
                    />
                    <span className="text-xs text-ink-soft leading-relaxed">
                      WhatsApp me about new arrivals, temple pooja recordings, and offers.
                      <span className="block text-[10px] text-ink-muted mt-0.5">You can turn this off anytime in Account settings. Reply STOP on WhatsApp to unsubscribe.</span>
                    </span>
                  </motion.label>
                  <motion.div variants={fieldVariants} className="relative">
                    <div className="halo-breathe absolute inset-x-4 -inset-y-1 rounded-full opacity-40 pointer-events-none"
                      style={{ background: "radial-gradient(circle, rgba(212,175,55,0.5) 0%, transparent 70%)" }} />
                    <AsyncButton data-testid="signup-submit" disabled={!agreed} loading={loading} loadingText="Creating account…"
                      className="relative w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest hover-lift disabled:opacity-50">
                      Create account
                    </AsyncButton>
                  </motion.div>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-6 text-center text-sm text-ink-muted">
            Already have an account? <Link to="/login" state={location.state} className="text-maroon underline underline-offset-4 decoration-gold-soft">Sign in</Link>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <AuthVisualPanel
            eyebrow="Join the vault"
            title="Every stone, certified. Every order, blessed."
            tagline="Create your account to unlock hallmark certificates, astrologer consultations, and early access to new arrivals."
            points={["Free QR authenticity certificate", "WhatsApp order updates", "Priority consultation booking"]}
          />
        </div>
      </motion.div>
    </div>
  );
}
