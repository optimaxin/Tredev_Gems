import React from "react";
import { CheckCircle, Package, CreditCard, Truck, XCircle, ArrowUUpLeft, WarningCircle } from "@phosphor-icons/react";

const fmtDT = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The order_status enum only has these checkpoints (no separate "packed" state —
// dispatch and packing happen in the same admin action), so that's the granularity
// we can honestly show; each step's timestamp comes straight from order_events.
const HAPPY_PATH = [
  { status: "placed", label: "Order placed", Icon: Package },
  { status: "paid", label: "Payment confirmed", Icon: CreditCard },
  { status: "shipped", label: "Packed & dispatched", Icon: Truck },
  { status: "delivered", label: "Delivered", Icon: CheckCircle },
];

const TERMINAL = {
  cancelled: { label: "Order cancelled", Icon: XCircle },
  refunded: { label: "Refunded", Icon: ArrowUUpLeft },
  payment_failed: { label: "Payment failed", Icon: WarningCircle },
};

/* Amazon/Flipkart-style vertical tracking line — Order placed, Payment confirmed,
   Packed & dispatched, Delivered — sourced from the order_events audit trail, with
   an exception branch (cancelled/refunded/payment failed) replacing the rest of
   the happy path once one of those actually happened. */
export default function OrderTracking({ order }) {
  const at = (status) => order.events?.find((e) => e.status === status)?.at;
  const terminalStatus = ["cancelled", "refunded", "payment_failed"].find((s) => at(s));

  const steps = HAPPY_PATH.map((s) => ({ ...s, at: s.status === "placed" ? order.created_at : at(s.status) }));

  let visible = steps;
  if (terminalStatus) {
    const cutIdx = steps.findIndex((s) => !s.at);
    const t = TERMINAL[terminalStatus];
    visible = (cutIdx === -1 ? steps : steps.slice(0, cutIdx)).concat([
      { status: terminalStatus, label: t.label, Icon: t.Icon, at: at(terminalStatus), failed: true },
    ]);
  }

  return (
    <div data-testid={`order-tracking-${order.order_id}`}>
      <div className="text-xs uppercase tracking-widest text-ink-muted mb-3">Tracking</div>
      <div>
        {visible.map((s, i) => {
          const done = !!s.at;
          const isLast = i === visible.length - 1;
          return (
            <div key={s.status} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  s.failed ? "bg-revoked text-ivory" : done ? "brand-gradient text-ivory" : "gold-line bg-ivory text-ink-muted"}`}>
                  <s.Icon size={14} weight={done || s.failed ? "fill" : "regular"} />
                </div>
                {!isLast && <div className={`w-px flex-1 min-h-[26px] ${done && !s.failed ? "bg-gold" : "bg-gold/25"}`} />}
              </div>
              <div className={isLast ? "pb-0" : "pb-6"}>
                <div className={`text-sm ${s.failed ? "text-revoked" : done ? "text-ink" : "text-ink-muted"}`}>{s.label}</div>
                <div className="text-xs text-ink-muted mt-0.5">
                  {done
                    ? fmtDT(s.at)
                    : s.status === "delivered" && order.estimated_delivery_date
                      ? `Est. delivery ${new Date(order.estimated_delivery_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                      : "Pending"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {(order.courier || order.tracking_number) && (
        <div className="mt-1 text-xs text-ink-muted flex items-center gap-1.5">
          <Truck size={14} weight="duotone" />
          {order.courier && <span>{order.courier}</span>}
          {order.tracking_number && <span className="font-mono">{order.tracking_number}</span>}
        </div>
      )}
    </div>
  );
}
