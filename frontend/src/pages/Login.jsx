import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { GoogleLogo, Phone, Envelope } from "@phosphor-icons/react";
import PhoneVerify from "@/components/gemora/PhoneVerify";
import AuthVisualPanel from "@/components/gemora/AuthVisualPanel";
import AsyncButton from "@/components/gemora/AsyncButton";

const TABS = [
  { key: "password", label: "Email + Password", Icon: Envelope },
  { key: "otp", label: "Phone OTP", Icon: Phone },
];

const fieldVariants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };
const formVariants = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };

export default function Login() {
  const { loginJwt, googleLogin, refresh } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  // e.g. the cart sends { from: "/cart" } so logging in to see the total/checkout
  // lands back on the cart instead of the generic account page.
  const dest = location.state?.from || "/account";
  const [mode, setMode] = useState("password");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const checkEmail = (v) => setEmailErr(v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "Enter a valid email address" : "");

  const passwordLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await loginJwt(email, pw);
      toast.success("Welcome back");
      nav(dest);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Login failed");
    } finally { setLoading(false); }
  };

  // Firebase phone verify: if backend finds an existing user with that phone,
  // it returns { session: { token, user } } → we log them in. Otherwise → signup.
  const onFbVerified = async (phone, _otpToken, session) => {
    if (session?.token) {
      localStorage.setItem("gemora_jwt", session.token);
      await refresh();
      toast.success("Welcome back");
      nav(dest);
    } else {
      toast.error("No account with that phone number. Please sign up.");
      nav("/signup", { state: location.state });
    }
  };

  // Google sign-in goes through Firebase directly (popup -> ID token -> our JWT).
  // Previously this redirected to auth.emergentagent.com and bounced back through
  // /auth/callback; there's no redirect hop now.
  const google = async () => {
    setLoading(true);
    try {
      await googleLogin();
      nav(dest);
    } catch (err) {
      if (err?.code === "auth/popup-closed-by-user") return; // user just dismissed it
      toast.error(err?.response?.data?.detail || err?.message || "Google sign-in failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="relative overflow-hidden px-4 sm:px-6 py-12 md:py-16">
      <div className="absolute inset-0 geom-bg pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="relative mx-auto max-w-4xl grid lg:grid-cols-[1fr_1.05fr] gold-line-strong overflow-hidden bg-ivory shadow-[0_30px_80px_-30px_rgba(78,31,38,0.35)]"
      >
        <AuthVisualPanel
          eyebrow="Welcome back"
          title="Your vault of blessings awaits"
          tagline="Sign in to track orders, revisit certified pieces, and pick up your consultations where you left off."
          points={["Hallmark-certified gemstones", "Astrologer-guided consultations", "Order tracking, end to end"]}
        />

        <div className="p-8 sm:p-10 md:p-12">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Welcome back</div>
            <h1 className="font-display text-4xl text-ink mt-1">Sign in to Tredev</h1>
          </div>

          <div className="relative mt-8 grid grid-cols-2 gold-line overflow-hidden text-sm bg-cream" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                data-testid={`login-mode-${t.key}`}
                onClick={() => setMode(t.key)}
                className={`relative py-3 flex items-center justify-center gap-2 transition-colors ${mode === t.key ? "text-ivory" : "text-ink-soft hover:text-maroon"}`}
              >
                {mode === t.key && (
                  <motion.span
                    layoutId="login-tab-pill"
                    className="absolute inset-0 brand-gradient"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <t.Icon size={14} weight="duotone" /> {t.label}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-6">
            {mode === "password" ? (
              <motion.form
                onSubmit={passwordLogin}
                variants={formVariants}
                initial="hidden"
                animate="show"
                className="gold-line bg-ivory p-8 space-y-4"
              >
                <motion.label variants={fieldVariants} className="block">
                  <div className="text-xs text-ink-muted mb-1">Email</div>
                  <input data-testid="login-email" required value={email}
                    onChange={(e) => { setEmail(e.target.value); if (emailErr) checkEmail(e.target.value); }}
                    onBlur={(e) => checkEmail(e.target.value)} type="email"
                    className={`w-full px-4 py-3 outline-none transition-shadow focus:ring-2 ${emailErr ? "border border-revoked focus:ring-revoked/20" : "gold-line focus:border-maroon focus:ring-gold/30"}`} />
                  {emailErr && <div role="alert" className="mt-1 text-xs text-revoked">{emailErr}</div>}
                </motion.label>
                <motion.label variants={fieldVariants} className="block">
                  <div className="text-xs text-ink-muted mb-1">Password</div>
                  <input data-testid="login-password" required value={pw} onChange={(e) => setPw(e.target.value)} type="password"
                    className="w-full gold-line px-4 py-3 outline-none transition-shadow focus:border-maroon focus:ring-2 focus:ring-gold/30" />
                </motion.label>
                <motion.div variants={fieldVariants} className="relative">
                  <div className="halo-breathe absolute inset-x-4 -inset-y-1 rounded-full opacity-40 pointer-events-none"
                    style={{ background: "radial-gradient(circle, rgba(212,175,55,0.5) 0%, transparent 70%)" }} />
                  <AsyncButton data-testid="login-submit" loading={loading} loadingText="Signing in…"
                    className="relative w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest hover-lift disabled:opacity-50">
                    Sign in
                  </AsyncButton>
                </motion.div>
              </motion.form>
            ) : (
              <motion.div key="otp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
                <PhoneVerify onVerified={onFbVerified} />
              </motion.div>
            )}

            <div className="relative py-4 text-center text-[11px] text-ink-muted">
              <span className="bg-ivory px-3 relative z-10">or</span>
              <div className="absolute top-1/2 left-0 right-0 h-px bg-gold/30" />
            </div>
            <AsyncButton type="button" onClick={google} loading={loading} loadingText="Signing in…" data-testid="login-google"
              className="w-full border border-maroon text-maroon py-3 text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-maroon hover:text-ivory transition-colors">
              <GoogleLogo size={16} weight="bold" /> Continue with Google
            </AsyncButton>
            <div className="mt-4 text-center text-sm text-ink-muted">
              New here? <Link to="/signup" state={location.state} className="text-maroon underline underline-offset-4 decoration-gold-soft">Create an account</Link>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
