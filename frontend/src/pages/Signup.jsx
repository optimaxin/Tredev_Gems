import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { GoogleLogo, ShieldCheck, CheckCircle } from "@phosphor-icons/react";
import PhoneVerify from "@/components/gemora/PhoneVerify";
import { api } from "@/lib/api";

export default function Signup() {
  const { refresh, googleLogin } = useAuth();
  const nav = useNavigate();

  const [step, setStep] = useState(1); // 1 = verify phone, 2 = account details
  const [phone, setPhone] = useState("");
  const [otpToken, setOtpToken] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", wa_optin: true });
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((x) => ({ ...x, [k]: e.target.value }));

  const onVerified = (p, token) => {
    setPhone(p); setOtpToken(token); setStep(2);
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/signup", {
        name: form.name, email: form.email, password: form.password,
        phone, otp_verification_token: otpToken, wa_optin: form.wa_optin,
      });
      localStorage.setItem("gemora_jwt", data.token);
      await refresh();
      toast.success("Welcome to Tredev");
      nav("/account");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  // Google sign-up == Google sign-in: Firebase popup -> ID token -> our JWT.
  // /auth/google creates the account if the email is new.
  const google = async () => {
    try {
      await googleLogin();
      nav("/account");
    } catch (err) {
      if (err?.code === "auth/popup-closed-by-user") return;
      toast.error(err?.response?.data?.detail || err?.message || "Google sign-in failed");
    }
  };

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <div className="text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Join the vault</div>
        <h1 className="font-display text-4xl text-ink mt-3">Create your account</h1>
      </div>

      {/* Stepper */}
      <div className="mt-8 flex items-center justify-center gap-3 text-xs">
        <div className={`flex items-center gap-2 ${step >= 1 ? "text-maroon-deep" : "text-ink-muted"}`}>
          <span className={`w-6 h-6 flex items-center justify-center border ${step >= 1 ? "border-maroon bg-maroon text-ivory" : "border-gold/40"}`}>
            {step > 1 ? <CheckCircle size={14} weight="fill" /> : "1"}
          </span>
          <span className="uppercase tracking-widest">Verify phone</span>
        </div>
        <div className="w-8 h-px bg-gold/40" />
        <div className={`flex items-center gap-2 ${step >= 2 ? "text-maroon-deep" : "text-ink-muted"}`}>
          <span className={`w-6 h-6 flex items-center justify-center border ${step >= 2 ? "border-maroon bg-maroon text-ivory" : "border-gold/40"}`}>2</span>
          <span className="uppercase tracking-widest">Your details</span>
        </div>
      </div>

      <div className="mt-8">
        {step === 1 ? (
          <>
            <PhoneVerify onVerified={onVerified} />
            <div className="relative py-4 text-center text-[11px] text-ink-muted">
              <span className="bg-ivory px-3 relative z-10">or</span>
              <div className="absolute top-1/2 left-0 right-0 h-px bg-gold/30" />
            </div>
            <button
              type="button"
              onClick={google}
              data-testid="signup-google"
              className="w-full border border-maroon text-maroon py-3 text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-maroon hover:text-ivory transition-colors"
            >
              <GoogleLogo size={16} weight="bold" /> Continue with Google
            </button>
            <p className="mt-3 text-[11px] text-ink-muted text-center">
              Google users still need to verify a phone number after signing in.
            </p>
          </>
        ) : (
          <form onSubmit={submit} className="gold-line bg-ivory p-8 space-y-4">
            <div className="flex items-center gap-2 text-verified text-xs mb-2">
              <ShieldCheck size={14} weight="duotone" /> Phone verified · <span className="font-mono">{phone}</span>
              <button type="button" onClick={() => setStep(1)} className="ml-auto text-ink-muted underline">change</button>
            </div>
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Full name</div>
              <input data-testid="signup-name" required value={form.name} onChange={set("name")} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" autoFocus />
            </label>
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Email</div>
              <input data-testid="signup-email" required value={form.email} onChange={set("email")} type="email" className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
            </label>
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Password</div>
              <input data-testid="signup-password" required value={form.password} onChange={set("password")} type="password" minLength={6} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
            </label>
            <label className="flex items-start gap-3 mt-2 cursor-pointer group">
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
            </label>
            <button data-testid="signup-submit" disabled={loading} className="w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest hover-lift disabled:opacity-50">
              {loading ? "Creating…" : "Create account"}
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 text-center text-sm text-ink-muted">
        Already have an account? <Link to="/login" className="text-maroon underline underline-offset-4 decoration-gold-soft">Sign in</Link>
      </div>
    </div>
  );
}
