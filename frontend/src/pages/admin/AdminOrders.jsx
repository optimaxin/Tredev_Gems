import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import { PaperPlaneTilt } from "@phosphor-icons/react";

const STATUSES = ["pending_payment", "paid", "shipped", "delivered", "cancelled", "refunded"];

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("");

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

  const dispatch = async (order_id, unit_id) => {
    try {
      await api.post("/admin/dispatch", { order_id, unit_id, tracking_number: `BD${Math.floor(Math.random() * 1e10)}`, courier: "BlueDart" });
      toast.success("Dispatched · QR activated"); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

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
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="font-mono text-xs text-ink-muted">{o.order_id}</div>
                <div className="text-sm text-ink">{new Date(o.created_at).toLocaleString()}</div>
                <div className="text-xs text-ink-muted mt-1">{o.shipping?.shipping_name} · {o.shipping?.shipping_city}</div>
              </div>
              <div className="text-right">
                <div className="font-display text-2xl text-maroon-deep">{formatINR(o.total)}</div>
                <select value={o.status} onChange={(e) => setStatus(o.order_id, e.target.value)} className="mt-1 gold-line text-xs bg-ivory px-2 py-1 uppercase tracking-widest">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-4 grid md:grid-cols-2 gap-2">
              {o.items.map((li) => (
                <div key={li.line_id} className="flex items-center justify-between text-sm gold-line bg-cream px-3 py-2">
                  <div>
                    <div className="font-serifd">{li.name}</div>
                    <div className="text-[10px] font-mono text-ink-muted">{li.unit_id?.slice(0, 20) || "no unit"}</div>
                  </div>
                  {o.status === "paid" && li.unit_id && (
                    <button onClick={() => dispatch(o.order_id, li.unit_id)} className="text-xs uppercase tracking-widest border border-maroon text-maroon px-2 py-1 inline-flex items-center gap-1 hover:bg-maroon hover:text-ivory transition-colors">
                      <PaperPlaneTilt size={12} weight="duotone" /> Dispatch
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
