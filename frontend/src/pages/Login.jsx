import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { GoogleLogo, WhatsappLogo, Envelope } from "@phosphor-icons/react";
import PhoneVerify from "@/components/gemora/PhoneVerify";

export default function Login() {
  const { loginJwt, googleLogin, refresh } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState("password");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await loginJwt(email, pw);
      toast.success("Welcome back");
      nav("/account");
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
      nav("/account");
    } else {
      toast.error("No account with that phone number. Please sign up.");
      nav("/signup");
    }
  };

  // Google sign-in goes through Firebase directly (popup -> ID token -> our JWT).
  // Previously this redirected to auth.emergentagent.com and bounced back through
  // /auth/callback; there's no redirect hop now.
  const google = async () => {
    setLoading(true);
    try {
      await googleLogin();
      nav("/account");
    } catch (err) {
      if (err?.code === "auth/popup-closed-by-user") return; // user just dismissed it
      toast.error(err?.response?.data?.detail || err?.message || "Google sign-in failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <div className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Welcome back</div>
        <h1 className="font-display text-4xl text-ink mt-3">Sign in to Tredev</h1>
      </div>

      <div className="mt-8 grid grid-cols-2 gold-line overflow-hidden text-sm" role="tablist">
        <button role="tab" data-testid="login-mode-password" onClick={() => setMode("password")}
          className={`py-3 flex items-center justify-center gap-2 ${mode === "password" ? "bg-maroon text-ivory" : "bg-ivory text-ink-soft hover:bg-cream"}`}>
          <Envelope size={14} weight="duotone" /> Email + Password
        </button>
        <button role="tab" data-testid="login-mode-otp" onClick={() => setMode("otp")}
          className={`py-3 flex items-center justify-center gap-2 ${mode === "otp" ? "bg-maroon text-ivory" : "bg-ivory text-ink-soft hover:bg-cream"}`}>
          <WhatsappLogo size={14} weight="duotone" /> Phone OTP
        </button>
      </div>

      <div className="mt-6">
        {mode === "password" ? (
          <form onSubmit={passwordLogin} className="gold-line bg-ivory p-8 space-y-4">
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Email</div>
              <input data-testid="login-email" required value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
            </label>
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Password</div>
              <input data-testid="login-password" required value={pw} onChange={(e) => setPw(e.target.value)} type="password" className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
            </label>
            <button data-testid="login-submit" disabled={loading} className="w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest hover-lift disabled:opacity-50">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <PhoneVerify onVerified={onFbVerified} />
        )}

        <div className="relative py-4 text-center text-[11px] text-ink-muted">
          <span className="bg-ivory px-3 relative z-10">or</span>
          <div className="absolute top-1/2 left-0 right-0 h-px bg-gold/30" />
        </div>
        <button type="button" onClick={google} data-testid="login-google" className="w-full border border-maroon text-maroon py-3 text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-maroon hover:text-ivory transition-colors">
          <GoogleLogo size={16} weight="bold" /> Continue with Google
        </button>
        <div className="mt-4 text-center text-sm text-ink-muted">
          New here? <Link to="/signup" className="text-maroon underline underline-offset-4 decoration-gold-soft">Create an account</Link>
        </div>
      </div>
    </div>
  );
}
