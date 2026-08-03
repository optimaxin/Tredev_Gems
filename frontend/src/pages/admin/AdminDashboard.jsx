import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import {
  CurrencyInr, ShoppingCart, UsersFour, ChatCircleDots, XCircle,
  ArrowUUpLeft, Fire, CalendarCheck, Heart,
} from "@phosphor-icons/react";

// "3h ago" — recency is what matters on a live feed; exact time is in the title.
const relTime = (iso) => {
  if (!iso) return "—";
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
};

const ACTIVITY = {
  order: { Icon: ShoppingCart, tone: "text-verified", label: "New order" },
  cancellation: { Icon: XCircle, tone: "text-revoked", label: "Order cancelled" },
  refund: { Icon: ArrowUUpLeft, tone: "text-revoked", label: "Order refunded" },
  consultation: { Icon: CalendarCheck, tone: "text-maroon", label: "Consultation request" },
  lead: { Icon: Heart, tone: "text-gold-soft", label: "New lead" },
};

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [low, setLow] = useState([]);
  const [days, setDays] = useState(30);
  useEffect(() => {
    const load = () => {
      api.get(`/admin/sales?days=${days}`).then((r) => setData(r.data)).catch(() => setData({ error: true }));
      api.get("/admin/inventory/low-stock?threshold=0").then((r) => setLow(r.data)).catch(() => {});
    };
    load();
    // ponytail: plain polling, add push/websocket if 30s staleness ever matters.
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [days]);

  if (!data) return <div className="text-ink-muted">Loading sales…</div>;
  if (data.error) return <div className="gold-line p-10 text-center text-ink-muted">Unable to load sales.</div>;

  const cards = [
    { Icon: CurrencyInr, label: "Revenue", value: formatINR(data.revenue_paise), sub: `AOV ${formatINR(data.aov_paise)}` },
    { Icon: ShoppingCart, label: "Orders", value: data.orders_total, sub: `${data.orders_paid} paid` },
    { Icon: UsersFour, label: "Customers", value: data.customers_total, sub: `${data.new_customers} new` },
    { Icon: ChatCircleDots, label: "Open Queries", value: data.open_queries, sub: `${days}-day window` },
    { Icon: Fire, label: "New Leads", value: data.new_leads, sub: "wishlist adds" },
    { Icon: CalendarCheck, label: "Consultations", value: data.new_consultations, sub: "requested" },
    { Icon: XCircle, label: "Cancelled", value: data.cancelled, sub: `${days}-day window` },
    { Icon: ArrowUUpLeft, label: "Refunded", value: data.refunded, sub: `${days}-day window` },
  ];

  const maxRev = Math.max(...data.by_day.map((d) => d.revenue), 1);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Overview</div>
          <h1 className="font-display text-4xl text-ink mt-1">Sales dashboard</h1>
        </div>
        <select value={days} onChange={(e) => setDays(+e.target.value)} className="gold-line px-3 py-2 text-sm bg-ivory" data-testid="admin-sales-window">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="gold-line bg-ivory p-5">
            <div className="flex items-center gap-2 text-gold-soft"><c.Icon size={18} weight="duotone" /><span className="text-[10px] uppercase tracking-widest">{c.label}</span></div>
            <div className="font-display text-3xl text-maroon-deep mt-2">{c.value}</div>
            <div className="text-xs text-ink-muted mt-1">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid lg:grid-cols-[1.6fr_1fr] gap-6">
        <div className="gold-line bg-ivory p-6">
          <div className="font-serifd text-xl text-maroon-deep">Revenue · by day</div>
          <div className="mt-6 flex items-end gap-2 h-56">
            {data.by_day.length === 0 ? <div className="text-ink-muted text-sm w-full text-center">No paid orders yet.</div> : data.by_day.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="w-full brand-gradient" style={{ height: `${(d.revenue / maxRev) * 100}%`, minHeight: "4px" }} title={`${d.day}: ${formatINR(d.revenue)}`} />
                <div className="text-[9px] font-mono text-ink-muted truncate w-full text-center">{d.day.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="gold-line bg-ivory p-6">
          <div className="font-serifd text-xl text-maroon-deep">Revenue · by category</div>
          <div className="mt-4 space-y-3">
            {data.by_category.length === 0 && <div className="text-ink-muted text-sm">Nothing yet.</div>}
            {data.by_category.sort((a, b) => b.revenue_paise - a.revenue_paise).map((c) => (
              <div key={c.category}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="capitalize">{c.category.replace("_", " ")}</span>
                  <span className="font-mono">{formatINR(c.revenue_paise)}</span>
                </div>
                <div className="h-1 bg-cream mt-1">
                  <div className="h-1 brand-gradient" style={{ width: `${(c.revenue_paise / (data.by_category[0]?.revenue_paise || 1)) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 gold-line bg-ivory p-6" data-testid="activity-feed-card">
        <div className="flex items-baseline justify-between">
          <div className="font-serifd text-xl text-maroon-deep">Live activity</div>
          <div className="text-xs text-ink-muted">Orders, leads, consultations, cancellations &amp; refunds · refreshes every 30s</div>
        </div>
        {(!data.activity || data.activity.length === 0) ? (
          <div className="mt-4 text-sm text-ink-muted">Nothing in the last {days} days.</div>
        ) : (
          <div className="mt-4 max-h-96 overflow-y-auto divide-y divide-gold/15">
            {data.activity.map((a, i) => {
              const meta = ACTIVITY[a.type] || ACTIVITY.order;
              return (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <meta.Icon size={18} weight="duotone" className={`shrink-0 ${meta.tone}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">
                      <span className={meta.tone}>{meta.label}</span>
                      {a.name && <span className="text-ink-muted"> · {a.name}</span>}
                    </div>
                    {a.extra && <div className="text-xs text-ink-muted truncate">{a.extra}</div>}
                  </div>
                  {a.amount_paise != null && <div className="text-sm font-mono shrink-0">{formatINR(a.amount_paise)}</div>}
                  <div className="text-[11px] text-ink-muted shrink-0 w-14 text-right" title={a.at}>{relTime(a.at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-6 gold-line bg-ivory p-6" data-testid="low-stock-card">
        <div className="flex items-baseline justify-between">
          <div className="font-serifd text-xl text-maroon-deep">Out-of-stock inventory</div>
          <div className="text-xs text-ink-muted">Serialised SKUs with 0 units available</div>
        </div>
        {low.length === 0 ? (
          <div className="mt-4 text-sm text-verified">All serialised SKUs in stock.</div>
        ) : (
          <div className="mt-4 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {low.map((p) => (
              <div key={p.product_id} className="gold-line p-3 flex items-center gap-3 border-revoked">
                {p.image && <div className="w-14 h-14 gold-line overflow-hidden shrink-0"><img src={p.image} alt="" className="w-full h-full object-cover" /></div>}
                <div className="flex-1 min-w-0">
                  <div className="font-serifd truncate">{p.name}</div>
                  <div className="text-xs text-revoked">Out of stock · needs intake</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
