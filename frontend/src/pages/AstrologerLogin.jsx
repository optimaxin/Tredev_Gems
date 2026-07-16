import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAstroAuth } from "@/context/AstroAuthContext";
import { toast } from "sonner";
import { Sparkle, EnvelopeSimple, LockKey } from "@phosphor-icons/react";

export default function AstrologerLogin() {
  const { login } = useAstroAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email.trim(), password);
      toast.success("Welcome back");
      nav("/astrologer/dashboard");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Sparkle size={40} weight="duotone" className="text-gold mx-auto" />
          <div className="mt-3 text-xs uppercase tracking-[0.4em] text-gold-soft">Tredev · Astrologer</div>
          <h1 className="font-display text-4xl text-maroon-deep mt-2">Sign in</h1>
          <p className="text-sm text-ink-muted mt-2">Access your dashboard, consultations & affiliate earnings.</p>
        </div>

        <form onSubmit={submit} className="gold-line-strong bg-ivory p-8 space-y-5">
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Email</div>
            <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
              <span className="px-3 py-3 bg-cream text-ink-soft border-r border-gold/30"><EnvelopeSimple size={16} /></span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                data-testid="astro-login-email" className="flex-1 px-3 py-3 outline-none" autoFocus />
            </div>
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Password</div>
            <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
              <span className="px-3 py-3 bg-cream text-ink-soft border-r border-gold/30"><LockKey size={16} /></span>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                data-testid="astro-login-password" className="flex-1 px-3 py-3 outline-none" />
            </div>
          </label>
          <button type="submit" disabled={busy} data-testid="astro-login-submit"
            className="w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift disabled:opacity-50">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div className="text-xs text-ink-muted text-center">
            No account yet? Contact Tredev admin — they'll send you a welcome link.
          </div>
        </form>
      </div>
    </div>
  );
}
