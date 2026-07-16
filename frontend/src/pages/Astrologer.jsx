import React from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { useAstroAuth } from "@/context/AstroAuthContext";
import { House, Calendar, Sparkle, LinkSimple, SignOut, User } from "@phosphor-icons/react";

import AstroDashboard from "@/pages/astrologer/AstroDashboard";
import AstroConsultations from "@/pages/astrologer/AstroConsultations";
import AstroAvailability from "@/pages/astrologer/AstroAvailability";
import AstroAffiliate from "@/pages/astrologer/AstroAffiliate";

const NAV = [
  { to: "/astrologer/dashboard", label: "Dashboard", Icon: House },
  { to: "/astrologer/consultations", label: "Consultations", Icon: Calendar },
  { to: "/astrologer/availability", label: "Availability", Icon: Sparkle },
  { to: "/astrologer/affiliate", label: "Affiliate & earnings", Icon: LinkSimple },
];

export default function Astrologer() {
  const { astro, loading, logout } = useAstroAuth();
  const nav = useNavigate();
  if (loading) return <div className="p-10 text-ink-muted">Loading…</div>;
  if (!astro) return <Navigate to="/astrologer/login" replace />;

  return (
    <div className="min-h-screen bg-cream flex">
      <aside className="w-64 shrink-0 bg-maroon-deep text-ivory min-h-screen p-6 flex flex-col">
        <div className="text-xs uppercase tracking-[0.4em] text-gold">Tredev</div>
        <div className="font-display text-2xl mt-1">Astrologer</div>
        <div className="mt-6 flex items-center gap-3 border-t border-ivory/10 pt-6">
          {astro.picture ? (
            <img src={astro.picture} alt="" className="w-11 h-11 rounded-full object-cover border border-gold/40" />
          ) : (
            <div className="w-11 h-11 rounded-full bg-gold/20 flex items-center justify-center"><User size={20} /></div>
          )}
          <div className="min-w-0">
            <div className="text-sm truncate">{astro.name}</div>
            <div className="text-[10px] text-ivory/60 font-mono truncate">{astro.email}</div>
          </div>
        </div>
        <nav className="mt-8 space-y-1 flex-1">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} data-testid={`astro-nav-${to.split("/").pop()}`}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2 text-sm rounded-sm transition ${isActive ? "bg-gold/20 text-gold" : "text-ivory/80 hover:text-gold hover:bg-white/5"}`}>
              <Icon size={16} weight="duotone" /> {label}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => { logout(); nav("/astrologer/login"); }} data-testid="astro-logout"
          className="mt-6 flex items-center gap-2 text-xs text-ivory/70 hover:text-gold">
          <SignOut size={14} /> Sign out
        </button>
      </aside>

      <main className="flex-1 p-10 overflow-y-auto">
        <Routes>
          <Route index element={<Navigate to="/astrologer/dashboard" replace />} />
          <Route path="dashboard" element={<AstroDashboard />} />
          <Route path="consultations" element={<AstroConsultations />} />
          <Route path="availability" element={<AstroAvailability />} />
          <Route path="affiliate" element={<AstroAffiliate />} />
          <Route path="*" element={<Navigate to="/astrologer/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
