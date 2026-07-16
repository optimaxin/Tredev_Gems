import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { X, Sparkle } from "@phosphor-icons/react";

const DISMISS_KEY = "gemora_event_strip_dismissed";

/**
 * Rotating, dismissible announcement strip at the very top of the site.
 * Shows only events with show_in_strip=true and currently active.
 */
export default function EventStrip() {
  const [events, setEvents] = useState([]);
  const [idx, setIdx] = useState(0);
  const [dismissedIds, setDismissedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]"); } catch { return []; }
  });

  useEffect(() => {
    api.get("/events/active").then(({ data }) => setEvents(data.filter((e) => e.show_in_strip))).catch(() => {});
  }, []);

  useEffect(() => {
    if (events.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % events.length), 5000);
    return () => clearInterval(t);
  }, [events.length]);

  const visible = events.filter((e) => !dismissedIds.includes(e.event_id));
  if (visible.length === 0) return null;
  const e = visible[idx % visible.length];

  const dismiss = () => {
    const next = [...dismissedIds, e.event_id];
    setDismissedIds(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch (_) {}
  };

  const inner = (
    <div className="flex items-center gap-3 justify-center text-ivory text-sm px-10 py-2 min-w-0">
      <Sparkle size={14} weight="duotone" className="text-gold shrink-0" />
      <span className="font-serifd truncate max-w-full">{e.title}</span>
      {e.subtitle && <span className="hidden sm:inline text-ivory/80 truncate">· {e.subtitle}</span>}
      {e.coupon_code && (
        <span className="hidden md:inline text-[11px] font-mono uppercase border border-gold/50 px-2 py-0.5 text-gold">CODE · {e.coupon_code}</span>
      )}
      {e.cta_link && e.cta_text && (
        <span className="ml-1 underline decoration-gold/60 underline-offset-4 hover:text-gold">{e.cta_text} →</span>
      )}
    </div>
  );

  return (
    <div className="relative brand-gradient" data-testid={`event-strip-${e.event_id}`}>
      {e.cta_link ? (<Link to={e.cta_link} className="block">{inner}</Link>) : inner}
      <button
        onClick={dismiss}
        data-testid="event-strip-dismiss"
        aria-label="Dismiss"
        className="absolute top-1/2 -translate-y-1/2 right-3 text-ivory/80 hover:text-ivory"
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}
