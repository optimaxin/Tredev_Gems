import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAstroAuth } from "@/context/AstroAuthContext";
import { toast } from "sonner";
import { CheckCircle, LockKey } from "@phosphor-icons/react";

export default function AstrologerSetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { setPassword } = useAstroAuth();
  const nav = useNavigate();
  const [password, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) toast.error("Missing setup token — please open the link from your welcome email.");
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (password !== confirm) { toast.error("Passwords don't match"); return; }
    setBusy(true);
    try {
      await setPassword(token, password);
      toast.success("Password set. Welcome to Tredev.");
      nav("/astrologer/dashboard");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "This link is invalid or has expired.");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <CheckCircle size={40} weight="duotone" className="text-verified mx-auto" />
          <div className="mt-3 text-xs uppercase tracking-[0.4em] text-gold-soft">Tredev · Astrologer</div>
          <h1 className="font-display text-4xl text-maroon-deep mt-2">Set your password</h1>
          <p className="text-sm text-ink-muted mt-2">Choose a password to activate your Tredev astrologer account.</p>
        </div>

        <form onSubmit={submit} className="gold-line-strong bg-ivory p-8 space-y-5">
          {[
            ["New password", password, setPwd, "astro-set-password"],
            ["Confirm password", confirm, setConfirm, "astro-set-password-confirm"],
          ].map(([label, val, set, tid]) => (
            <label key={label} className="block">
              <div className="text-xs text-ink-muted mb-1">{label}</div>
              <div className="flex gold-line bg-ivory overflow-hidden focus-within:border-maroon">
                <span className="px-3 py-3 bg-cream text-ink-soft border-r border-gold/30"><LockKey size={16} /></span>
                <input type="password" required value={val} onChange={(e) => set(e.target.value)}
                  data-testid={tid} minLength={6} className="flex-1 px-3 py-3 outline-none" />
              </div>
            </label>
          ))}
          <button type="submit" disabled={busy || !token} data-testid="astro-set-submit"
            className="w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest hover-lift disabled:opacity-50">
            {busy ? "Setting up…" : "Set password & go to dashboard"}
          </button>
        </form>
      </div>
    </div>
  );
}
