import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { absolutize } from "@/context/SiteAssetsContext";
import { MegaphoneSimple, ArrowRight, Ticket, CalendarBlank } from "@phosphor-icons/react";

function countdown(iso) {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  const now = Date.now();
  const diff = end - now;
  if (diff <= 0) return null;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

/**
 * Dedicated homepage section listing all currently-running events (show_in_section=true).
 */
export default function EventsSection() {
  const [events, setEvents] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api.get("/events/active").then(({ data }) => setEvents(data.filter((e) => e.show_in_section))).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60000);
    return () => clearInterval(t);
  }, []);

  if (events.length === 0) return null;

  // Balance the grid to the number of events so a single event never sits stranded
  // in a 3-column row with two empty cells beside it.
  const gridClass =
    events.length === 1
      ? "grid-cols-1 max-w-xl"
      : events.length === 2
      ? "grid-cols-1 sm:grid-cols-2 max-w-4xl"
      : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20" data-testid="home-events-section" data-tick={tick}>
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Now on · अवसर</div>
          <h2 className="font-display text-4xl md:text-5xl text-ink mt-2 flex items-center gap-3">
            <MegaphoneSimple size={40} weight="duotone" className="text-gold shrink-0" />
            Ongoing events &amp; giveaways
          </h2>
        </div>
      </div>

      <div className={`grid ${gridClass} gap-6 mx-auto`}>
        {events.map((e) => {
          const cd = countdown(e.ends_at);
          return (
            <div key={e.event_id} data-testid={`event-card-${e.event_id}`} className="gold-line-strong bg-ivory overflow-hidden flex flex-col hover-lift">
              {e.image_url ? (
                <div className="aspect-[16/9] overflow-hidden">
                  <img src={absolutize(e.image_url)} alt={e.title} className="w-full h-full object-cover img-hover" loading="lazy" />
                </div>
              ) : (
                <div className="aspect-[16/9] brand-gradient flex items-center justify-center text-ivory">
                  <MegaphoneSimple size={48} weight="duotone" />
                </div>
              )}
              <div className="p-6 flex flex-col gap-3 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {e.coupon_code && (
                    <span className="text-[10px] font-mono uppercase text-maroon border border-gold-soft px-2 py-0.5 inline-flex items-center gap-1">
                      <Ticket size={11} weight="duotone" /> {e.coupon_code}
                    </span>
                  )}
                  {cd && (
                    <span className="text-[10px] uppercase tracking-widest text-maroon bg-gold/15 px-2 py-0.5 inline-flex items-center gap-1">
                      <CalendarBlank size={11} weight="duotone" /> {cd}
                    </span>
                  )}
                </div>
                <div>
                  <div className="font-display text-2xl text-ink leading-tight line-clamp-2">{e.title}</div>
                  {e.subtitle && <div className="text-sm text-gold-soft mt-1 line-clamp-1">{e.subtitle}</div>}
                </div>
                {e.description && <p className="text-sm text-ink-soft leading-relaxed line-clamp-3">{e.description}</p>}
                {e.cta_link && e.cta_text && (
                  <Link
                    to={e.cta_link}
                    data-testid={`event-cta-${e.event_id}`}
                    className="mt-auto inline-flex items-center gap-2 self-start brand-gradient text-ivory px-5 py-2.5 text-xs uppercase tracking-widest hover-lift"
                  >
                    {e.cta_text} <ArrowRight size={12} weight="bold" />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
