import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiAstro } from "@/context/AstroAuthContext";
import { formatINR } from "@/lib/api";
import { Calendar, CheckCircle, Coins, TrendUp, ClockCounterClockwise, LinkSimple } from "@phosphor-icons/react";

function Stat({ label, value, sub, Icon, tid }) {
  return (
    <div className="gold-line bg-ivory p-5" data-testid={tid}>
      <div className="flex items-center gap-2 text-gold-soft text-xs uppercase tracking-widest">
        <Icon size={14} weight="duotone" /> {label}
      </div>
      <div className="mt-2 font-display text-3xl text-ink">{value}</div>
      {sub && <div className="text-[11px] text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

export default function AstroDashboard() {
  const [k, setK] = useState(null);
  useEffect(() => { apiAstro.get("/astrologer/dashboard").then((r) => setK(r.data)).catch(() => {}); }, []);

  return (
    <div>
      <div>
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Overview</div>
        <h1 className="font-display text-4xl text-ink mt-1">Dashboard</h1>
        <p className="text-sm text-ink-muted mt-1">Your consultations and affiliate earnings at a glance.</p>
      </div>

      {!k ? (
        <div className="mt-10 text-ink-muted">Loading…</div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Upcoming" value={k.upcoming} sub="requested or confirmed" Icon={Calendar} tid="kpi-upcoming" />
            <Stat label="Completed" value={k.completed} Icon={CheckCircle} tid="kpi-completed" />
            <Stat label="Total commission" value={formatINR(k.total_commission)} sub={`${k.affiliate_orders} orders`} Icon={Coins} tid="kpi-total-commission" />
            <Stat label="Pending payout" value={formatINR(k.pending_commission)} sub="not yet released" Icon={ClockCounterClockwise} tid="kpi-pending-commission" />
          </div>

          <div className="mt-10 grid md:grid-cols-2 gap-6">
            <Link to="/astrologer/consultations" className="gold-line-strong bg-ivory p-6 hover-lift">
              <div className="flex items-center gap-2 text-gold-soft text-xs uppercase tracking-widest">
                <Calendar size={14} weight="duotone" /> Consultations
              </div>
              <div className="mt-3 font-display text-2xl text-ink">Manage your bookings</div>
              <p className="text-sm text-ink-muted mt-2">See who's booked, join via Jitsi, add notes, mark complete.</p>
            </Link>
            <Link to="/astrologer/affiliate" className="gold-line-strong bg-ivory p-6 hover-lift">
              <div className="flex items-center gap-2 text-gold-soft text-xs uppercase tracking-widest">
                <LinkSimple size={14} weight="duotone" /> Affiliate
              </div>
              <div className="mt-3 font-display text-2xl text-ink">Your commission link</div>
              <p className="text-sm text-ink-muted mt-2">Share your personal link to earn on every purchase made through it.</p>
              <div className="mt-3 inline-flex items-center gap-1 text-maroon text-xs uppercase tracking-widest">
                <TrendUp size={12} weight="bold" /> View earnings & clicks
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
