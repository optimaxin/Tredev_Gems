import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { Phone, WhatsappLogo, Fire, ShoppingBag, Heart, VideoCamera } from "@phosphor-icons/react";
import SearchBar, { matchesQuery } from "@/components/gemora/SearchBar";

const STAGES = [
  { key: "checkout_started", label: "Checkout started", Icon: Fire, tone: "text-revoked border-revoked/40" },
  { key: "consultation_dropped", label: "Consultation dropped", Icon: VideoCamera, tone: "text-saffron border-saffron/40" },
  { key: "cart", label: "Cart", Icon: ShoppingBag, tone: "text-maroon border-maroon/30" },
  { key: "wishlist", label: "Wishlist", Icon: Heart, tone: "text-gold-soft border-gold/40" },
];
const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]));

// "3h ago" — recency is what matters for follow-up priority; exact time is in the title.
const relTime = (iso) => {
  if (!iso) return "—";
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

// A short, contextual opener for the pre-filled WhatsApp message — same recovery
// pitch every time, just naming whatever they actually left behind.
const waMessage = (lead) => {
  const item = lead.checkout?.items?.[0] || lead.consultation?.items?.[0] || lead.cart?.items?.[0] || lead.wishlist?.items?.[0];
  const name = lead.name ? lead.name.split(" ")[0] : "there";
  if (lead.checkout) {
    return `Hi ${name}, this is Tredev — noticed your payment for ${item || "your order"} didn't go through. Want help completing it? Happy to guide you.`;
  }
  if (lead.consultation) {
    return `Hi ${name}, this is Tredev — noticed your consultation booking wasn't paid for yet. Want help completing it?`;
  }
  if (lead.cart) {
    return `Hi ${name}, this is Tredev — you left ${item || "an item"} in your cart. Want help completing your purchase?`;
  }
  return `Hi ${name}, this is Tredev — saw you were interested in ${item || "a piece"}. Happy to answer any questions and help you order.`;
};

function StageBadge({ stage }) {
  const s = STAGE_BY_KEY[stage];
  if (!s) return null;
  return (
    <span className={`inline-flex items-center gap-1 border px-2 py-1 text-[10px] uppercase tracking-widest ${s.tone}`}>
      <s.Icon size={11} weight="bold" /> {s.label}
    </span>
  );
}

export default function AdminLeads() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.get("/admin/leads").then((r) => setLeads(r.data)).finally(() => setLoading(false));
  }, []);

  const shown = leads
    .filter((l) => !filter || l.stage === filter)
    .filter((l) => matchesQuery(query, [l.name, l.phone, l.email]));

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Sales recovery</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-1">Leads</h1>
      <p className="text-sm text-ink-muted mb-5">
        Customers who showed intent but didn't finish — reach out and help them across the line.
      </p>

      <SearchBar value={query} onChange={setQuery} placeholder="Search by name, phone or email…" testId="leads-search" className="mb-4 max-w-md" />

      <div className="flex gap-2 mb-4 flex-wrap">
        {[{ key: "", label: "All" }, ...STAGES].map((s) => (
          <button
            key={s.key || "all"}
            onClick={() => setFilter(s.key)}
            data-testid={`leads-filter-${s.key || "all"}`}
            className={`text-xs px-3 py-1.5 border ${filter === s.key ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft hover:border-maroon"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {loading && <div className="gold-line p-10 text-center text-ink-muted">Loading…</div>}
        {!loading && shown.length === 0 && (
          <div className="gold-line p-10 text-center text-ink-muted">
            {query || filter ? "No leads match this filter." : "No unconverted leads right now."}
          </div>
        )}
        {shown.map((l) => (
          <div key={l.user_id} data-testid={`lead-card-${l.user_id}`} className="gold-line bg-ivory p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-serifd text-lg">{l.name || "Unnamed customer"}</div>
                <div className="text-xs font-mono text-ink-muted">
                  {l.phone || "no phone"} · {l.email || "no email"}
                </div>
              </div>
              <div className="text-right shrink-0">
                <StageBadge stage={l.stage} />
                <div className="text-[11px] text-ink-muted mt-1" title={l.last_activity}>{relTime(l.last_activity)}</div>
              </div>
            </div>

            <div className="mt-3 text-sm text-ink-soft space-y-1">
              {l.checkout && (
                <div>
                  <span className="text-ink-muted">Started checkout</span> · {formatINR(l.checkout.value)} · {l.checkout.status}
                  {l.checkout.items?.length > 0 && <span> · {l.checkout.items.join(", ")}</span>}
                </div>
              )}
              {l.consultation && (
                <div>
                  <span className="text-ink-muted">Consultation booking</span> · {formatINR(l.consultation.value)}
                  {l.consultation.items?.length > 0 && <span> · {l.consultation.items.join(", ")}</span>}
                </div>
              )}
              {l.cart && (
                <div>
                  <span className="text-ink-muted">In cart</span> · {formatINR(l.cart.value)} · {l.cart.items?.join(", ")}
                </div>
              )}
              {l.wishlist && (
                <div>
                  <span className="text-ink-muted">Wishlisted</span> · {l.wishlist.items?.join(", ")}
                </div>
              )}
            </div>

            {l.phone && (
              <div className="mt-3 flex gap-3 text-xs">
                <a href={`tel:${l.phone}`} data-testid={`lead-call-${l.user_id}`}
                   className="border border-maroon text-maroon hover:bg-maroon hover:text-ivory px-3 py-1.5 inline-flex items-center gap-1.5 uppercase tracking-widest">
                  <Phone size={13} weight="fill" /> Call
                </a>
                <a href={`https://wa.me/${l.phone.replace(/\D/g, "")}?text=${encodeURIComponent(waMessage(l))}`}
                   target="_blank" rel="noreferrer" data-testid={`lead-whatsapp-${l.user_id}`}
                   className="border border-verified text-verified hover:bg-verified hover:text-ivory px-3 py-1.5 inline-flex items-center gap-1.5 uppercase tracking-widest">
                  <WhatsappLogo size={13} weight="fill" /> WhatsApp
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
