import React, { useEffect, useState } from "react";
import { api, formatINR, describeOptions } from "@/lib/api";
import { toast } from "sonner";
import { PaperPlaneTilt, X, User, ClockCounterClockwise, MapPin, Package, Phone } from "@phosphor-icons/react";

const STATUSES = ["pending_payment", "paid", "shipped", "delivered", "cancelled", "refunded"];

// Fulfilment blockers the backend flags on a line. Rendered as a red tag so staff can
// spot at a glance that the order needs a callback before it can be made/dispatched.
const FLAG_LABELS = { ring_size_unknown: "Ring size needed — contact customer" };

const FlagTags = ({ flags }) => (
  <>
    {(flags || []).map((f) => (
      <span key={f} data-testid={`flag-${f}`} className="inline-flex items-center gap-1 bg-revoked text-ivory text-[10px] uppercase tracking-widest px-2 py-0.5">
        <Phone size={10} weight="duotone" /> {FLAG_LABELS[f] || f}
      </span>
    ))}
  </>
);

// Sensible defaults so dispatch is a quick confirm, not a full data-entry form.
const dispatchDefaults = () => ({
  lab_name: "GJEPC Lab Mumbai",
  lab_report_no: `GJ-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
  temple_name: "Kashi Vishwanath Temple",
  temple_devanagari: "काशी विश्वनाथ मंदिर",
  priest_name: "Pandit Ashok Mishra",
  mantra: "ॐ नमः शिवाय",
  energization_date: new Date().toISOString().slice(0, 10),
  estimated_delivery_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
  tracking_number: `BD${Math.floor(Math.random() * 1e10)}`,
  courier: "BlueDart",
});

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("");
  const [dispatchFor, setDispatchFor] = useState(null); // order being dispatched
  const [dform, setDform] = useState(dispatchDefaults());
  const [sending, setSending] = useState(false);
  const [customer, setCustomer] = useState(null); // { profile, orders } for dispatchFor's buyer
  const [customerLoading, setCustomerLoading] = useState(false);

  const refresh = () => api.get("/admin/orders").then((r) => setOrders(r.data));
  useEffect(() => { refresh(); }, []);

  const setStatus = async (order_id, status) => {
    try {
      await api.patch(`/admin/orders/${order_id}/status`, { status });
      toast.success(`Order ${status}`); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  const removeOrder = async (order_id) => {
    if (!confirm(`Delete order ${order_id}? This will release its reserved units.`)) return;
    try {
      await api.delete(`/admin/orders/${order_id}`);
      toast.success("Order deleted"); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  const purgeAll = async () => {
    if (!confirm("Delete ALL orders? This cannot be undone. Reservations will be released and units returned to available stock.")) return;
    if (!confirm("Are you absolutely sure? Type-confirmation is disabled — this will nuke every order in the database.")) return;
    try {
      const { data } = await api.post("/admin/orders/purge");
      toast.success(`Purged ${data.deleted} orders`); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  const openDispatch = (order) => {
    setDispatchFor(order);
    setDform(dispatchDefaults());
    setCustomer(null);
    // Buyer profile + order history — staff need this to confirm who/what they're
    // shipping before certifying and dispatching.
    if (order.user_id) {
      setCustomerLoading(true);
      api.get(`/admin/customers/${order.user_id}`)
        .then((r) => setCustomer(r.data))
        .catch(() => setCustomer(false)) // false = failed to load, distinct from null = loading
        .finally(() => setCustomerLoading(false));
    }
  };

  const submitDispatch = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const { data } = await api.post("/admin/dispatch", { order_id: dispatchFor.order_id, ...dform });
      toast.success(`Dispatched · ${data.units} piece${data.units === 1 ? "" : "s"} certified · QR activated`);
      setDispatchFor(null); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
    finally { setSending(false); }
  };
  const dset = (k) => (e) => setDform((f) => ({ ...f, [k]: e.target.value }));

  const filtered = filter ? orders.filter((o) => o.status === filter) : orders;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Fulfilment</div>
          <h1 className="font-display text-4xl text-ink mt-1">Orders</h1>
        </div>
        <button onClick={purgeAll} data-testid="admin-orders-purge" className="text-xs uppercase tracking-widest border border-revoked text-revoked px-4 py-2 hover:bg-revoked hover:text-ivory transition-colors">
          Purge all order history
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {["", ...STATUSES].map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} className={`text-xs px-3 py-1.5 border ${filter === s ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft hover:border-maroon"}`}>
            {s || "All"}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {filtered.length === 0 && <div className="gold-line p-10 text-center text-ink-muted">No orders.</div>}
        {filtered.map((o) => (
          <div key={o.order_id} data-testid={`admin-order-${o.order_id}`} className="gold-line bg-ivory p-5">
            {o.items.some((li) => li.flags?.length) && (
              <div className="mb-3 border border-revoked bg-revoked/5 px-3 py-2 text-xs text-revoked flex items-center gap-2 flex-wrap">
                <Phone size={13} weight="duotone" className="shrink-0" />
                <span className="font-medium">Needs a callback before this can be made.</span>
                <span className="text-ink-soft">{o.shipping?.shipping_name} · {o.shipping?.shipping_phone}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="font-mono text-xs text-ink-muted">{o.order_id}</div>
                <div className="text-sm text-ink">{new Date(o.created_at).toLocaleString()}</div>
                <div className="text-xs text-ink-muted mt-1">
                  {o.shipping?.shipping_name} · {o.shipping?.shipping_phone}
                </div>
                <div className="text-xs text-ink-muted">
                  {[o.shipping?.shipping_address, o.shipping?.shipping_city, o.shipping?.shipping_state, o.shipping?.shipping_pincode].filter(Boolean).join(", ")}
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-2xl text-maroon-deep">{formatINR(o.total)}</div>
                <select value={o.status} onChange={(e) => setStatus(o.order_id, e.target.value)} className="mt-1 gold-line text-xs bg-ivory px-2 py-1 uppercase tracking-widest">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {o.status === "paid" && (
                  <div className="mt-2">
                    <button onClick={() => openDispatch(o)} data-testid={`dispatch-${o.order_id}`} className="text-xs uppercase tracking-widest border border-maroon text-maroon px-3 py-1.5 inline-flex items-center gap-1 hover:bg-maroon hover:text-ivory transition-colors">
                      <PaperPlaneTilt size={12} weight="duotone" /> Dispatch order
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 grid md:grid-cols-2 gap-2">
              {o.items.map((li) => (
                <div key={li.line_id} className="text-sm gold-line bg-cream px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="font-serifd">{li.name}</div>
                    <div className="text-xs text-ink-muted">Qty {li.qty}</div>
                  </div>
                  {describeOptions(li.options_list, { all: true }) && (
                    <div className="text-[10px] text-maroon mt-0.5">{describeOptions(li.options_list, { all: true })}</div>
                  )}
                  {li.flags?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1"><FlagTags flags={li.flags} /></div>
                  )}
                  {li.serials?.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {li.serials.map((s) => (
                        <span key={s} className="text-[10px] font-mono bg-ivory gold-line px-1.5 py-0.5">{s}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10px] font-mono text-ink-muted mt-1">
                      {li.is_serialized ? "units assigned at payment" : "non-serialized"}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {o.estimated_delivery_date && (
              <div className="mt-3 text-xs text-ink-muted">
                Est. delivery: <span className="text-ink">{new Date(o.estimated_delivery_date).toLocaleDateString()}</span>
                {o.tracking_number && <> · {o.courier} {o.tracking_number}</>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Dispatch form — captures provenance + ETA, then certifies every assigned unit */}
      {dispatchFor && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={() => setDispatchFor(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submitDispatch} className="bg-ivory gold-line-strong max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Fulfilment</div>
                <h2 className="font-display text-2xl text-ink mt-1">Dispatch order</h2>
              </div>
              <button type="button" onClick={() => setDispatchFor(null)} className="text-ink-muted hover:text-revoked"><X size={20} /></button>
            </div>

            {/* Customer — who we're shipping to, and their order history */}
            <div className="mt-5 gold-line bg-cream p-4">
              <div className="text-xs uppercase tracking-widest text-ink-muted flex items-center gap-1.5 mb-2">
                <User size={14} weight="duotone" /> Customer
              </div>
              {customerLoading && <div className="text-sm text-ink-muted animate-pulse">Loading profile…</div>}
              {customer === false && <div className="text-sm text-revoked">Could not load customer profile.</div>}
              {customer && (
                <>
                  <div className="text-sm">
                    <span className="font-serifd text-base">{customer.profile.name}</span>
                    {customer.profile.role !== "customer" && (
                      <span className="ml-2 text-[10px] uppercase tracking-widest text-maroon">{customer.profile.role}</span>
                    )}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {customer.profile.email} · {customer.profile.phone || "no phone on file"}
                  </div>
                  <div className="text-[10px] text-ink-muted mt-0.5">
                    Customer since {new Date(customer.profile.created_at).toLocaleDateString()}
                  </div>
                  <div className="mt-3 text-xs uppercase tracking-widest text-ink-muted flex items-center gap-1.5">
                    <ClockCounterClockwise size={13} weight="duotone" /> Order history ({customer.orders.length})
                  </div>
                  <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                    {customer.orders.map((ho) => (
                      <div key={ho.order_id} className={`flex items-center justify-between text-xs px-2 py-1 ${ho.order_id === dispatchFor.order_id ? "bg-gold/20" : ""}`}>
                        <span className="text-ink-soft">
                          {new Date(ho.created_at).toLocaleDateString()} · {ho.item_count} item{ho.item_count === 1 ? "" : "s"}
                          {ho.order_id === dispatchFor.order_id && <span className="ml-1 text-maroon">(this order)</span>}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="uppercase text-[10px] text-ink-muted">{ho.status}</span>
                          <span className="font-mono">{formatINR(ho.total)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Delivery — the address filled in at checkout */}
            <div className="mt-3 gold-line bg-cream p-4">
              <div className="text-xs uppercase tracking-widest text-ink-muted flex items-center gap-1.5 mb-2">
                <MapPin size={14} weight="duotone" /> Delivery address
              </div>
              <div className="text-sm">{dispatchFor.shipping?.shipping_name} · {dispatchFor.shipping?.shipping_phone}</div>
              <div className="text-sm text-ink-soft mt-0.5">{dispatchFor.shipping?.shipping_address}</div>
              <div className="text-sm text-ink-soft">
                {[dispatchFor.shipping?.shipping_city, dispatchFor.shipping?.shipping_state, dispatchFor.shipping?.shipping_pincode].filter(Boolean).join(", ")}
              </div>
              <div className="text-xs text-ink-muted mt-1">{dispatchFor.shipping?.email}</div>
            </div>

            {/* Items — what's actually being shipped */}
            <div className="mt-3 gold-line bg-cream p-4">
              <div className="text-xs uppercase tracking-widest text-ink-muted flex items-center gap-1.5 mb-2">
                <Package size={14} weight="duotone" /> Items on this order
              </div>
              <div className="space-y-2">
                {dispatchFor.items.map((li) => (
                  <div key={li.line_id} className="flex items-center gap-3 text-sm">
                    {li.image && <img src={li.image} alt="" className="w-10 h-10 object-cover gold-line shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{li.name} <span className="text-ink-muted">× {li.qty}</span></div>
                      {describeOptions(li.options_list, { all: true }) && (
                        <div className="text-[10px] text-maroon">{describeOptions(li.options_list, { all: true })}</div>
                      )}
                      {li.flags?.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1"><FlagTags flags={li.flags} /></div>
                      )}
                      {li.serials?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {li.serials.map((s) => <span key={s} className="text-[10px] font-mono bg-ivory gold-line px-1 py-0.5">{s}</span>)}
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-xs shrink-0">{formatINR(li.price * li.qty)}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-4 text-xs text-ink-muted">
              A signed certificate (lab report · temple energisation · Ed25519 signature) is issued for every piece on this order, then its QR is activated.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {[
                ["lab_name", "Lab name"], ["lab_report_no", "Lab report no."],
                ["temple_name", "Temple"], ["temple_devanagari", "Temple (Devanagari)"],
                ["priest_name", "Priest"], ["mantra", "Mantra"],
              ].map(([k, l]) => (
                <label key={k} className="block">
                  <div className="text-xs text-ink-muted mb-1">{l}</div>
                  <input value={dform[k] || ""} onChange={dset(k)} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon text-sm" />
                </label>
              ))}
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Energisation date</div>
                <input type="date" value={dform.energization_date} onChange={dset("energization_date")} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon text-sm" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Estimated delivery</div>
                <input type="date" value={dform.estimated_delivery_date} onChange={dset("estimated_delivery_date")} data-testid="dispatch-eta" className="w-full gold-line px-3 py-2 outline-none focus:border-maroon text-sm" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Courier</div>
                <input value={dform.courier || ""} onChange={dset("courier")} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon text-sm" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Tracking no.</div>
                <input value={dform.tracking_number || ""} onChange={dset("tracking_number")} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon text-sm" />
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="submit" disabled={sending} data-testid="dispatch-submit" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-50">
                <PaperPlaneTilt size={14} weight="duotone" /> {sending ? "Dispatching…" : "Certify & dispatch"}
              </button>
              <button type="button" onClick={() => setDispatchFor(null)} className="border border-gold/40 text-ink-soft px-5 py-3 text-xs uppercase tracking-widest">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
