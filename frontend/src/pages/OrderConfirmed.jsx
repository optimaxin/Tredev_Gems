import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { api, formatINR, describeOptions } from "@/lib/api";
import {
  ShieldCheck, QrCode, Truck, HandHeart, ArrowRight, Package, Sparkle, Certificate,
} from "@phosphor-icons/react";

const STEPS = [
  { Icon: HandHeart, title: "Certified & Energised", body: "Your unit is lab-tested and temple-energised by our in-house pandits, then Ed25519-signed." },
  { Icon: QrCode, title: "QR Activated on Dispatch", body: "We activate your certificate's QR the moment your parcel leaves the vault." },
  { Icon: Truck, title: "Delivered & Provable", body: "Receive it in premium packaging — scan the QR anytime to prove authenticity forever." },
];

/* A ring of gold marigold-style petals drifting down the page. */
function Petals({ reduce }) {
  const petals = useMemo(
    () =>
      Array.from({ length: 18 }).map((_, i) => ({
        left: `${(i * 5.6 + (i % 3) * 3) % 100}%`,
        delay: `${(i * 0.7).toFixed(1)}s`,
        dur: `${7 + (i % 5)}s`,
        size: 8 + (i % 4) * 3,
        sway: `${(i % 2 ? 1 : -1) * (30 + (i % 4) * 18)}px`,
        hue: i % 3, // 0 gold, 1 saffron, 2 maroon-soft
      })),
    []
  );
  if (reduce) return null;
  const colors = ["#D4AF37", "#F28C28", "#C9A227"];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {petals.map((p, i) => (
        <span
          key={i}
          className="petal"
          style={{
            left: p.left,
            width: p.size,
            height: p.size * 0.7,
            background: colors[p.hue],
            borderRadius: "60% 60% 60% 60% / 100% 100% 40% 40%",
            opacity: 0.75,
            animationDelay: p.delay,
            animationDuration: p.dur,
            "--sway": p.sway,
          }}
        />
      ))}
    </div>
  );
}

export default function OrderConfirmed() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    let alive = true;
    if (orderId) {
      api.get(`/orders/${orderId}`).then(({ data }) => alive && setOrder(data)).catch(() => {});
    }
    // celebratory scroll reset
    window.scrollTo(0, 0);
    return () => { alive = false; };
  }, [orderId]);

  const shortId = (orderId || "").slice(0, 8).toUpperCase();

  return (
    <section className="relative overflow-hidden bg-ivory geom-bg min-h-[92vh] flex items-center">
      {/* soft gold bloom behind the seal */}
      <div
        className="absolute left-1/2 top-24 -translate-x-1/2 w-[520px] h-[520px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(212,175,55,0.22) 0%, rgba(242,140,40,0.08) 40%, transparent 70%)" }}
      />
      <Petals reduce={reduce} />

      <div className="relative mx-auto max-w-3xl px-6 lg:px-10 py-20 text-center w-full">
        {/* ── Animated seal ── */}
        <div className="relative mx-auto w-40 h-40 flex items-center justify-center">
          {!reduce &&
            [0, 1, 2].map((i) => (
              <div
                key={i}
                className="aura-ring absolute inset-0 rounded-full border border-gold/40"
                style={{ animationDelay: `${i * 1.6}s` }}
              />
            ))}
          {/* rotating dashed gold ring */}
          <svg className="absolute inset-0 w-full h-full chakra-spin" viewBox="0 0 160 160" aria-hidden="true">
            <circle
              cx="80" cy="80" r="72" fill="none" stroke="#D4AF37" strokeWidth="1.5"
              strokeDasharray="2 8" opacity="0.7"
            />
            <circle cx="80" cy="80" r="63" fill="none" stroke="#C9A227" strokeWidth="1" opacity="0.4" />
          </svg>
          {/* seal disc + drawn check */}
          <div className="seal-pop relative w-28 h-28 rounded-full brand-gradient flex items-center justify-center shadow-[0_12px_40px_-10px_rgba(114,47,55,0.55)]">
            <motion.svg width="56" height="56" viewBox="0 0 52 52" fill="none">
              <motion.path
                d="M14 27 L23 36 L39 18"
                stroke="#FBFBF9"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ delay: 0.45, duration: 0.6, ease: "easeInOut" }}
              />
            </motion.svg>
          </div>
        </div>

        {/* ── Thank-you ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6 }}
        >
          <div className="mt-8 font-deva text-3xl text-gold-soft">धन्यवाद</div>
          <h1 className="mt-2 font-display text-5xl md:text-6xl leading-tight">
            <span className="shimmer-text">Your order is placed</span>
          </h1>
          <p className="mt-5 text-base md:text-lg text-ink-soft leading-relaxed max-w-xl mx-auto">
            Thank you for placing your trust in Tredev. Your sacred goods are being prepared with
            reverence — serialised, certified and signed, exactly as promised.
          </p>

          {/* order id chip */}
          {orderId && (
            <div className="mt-6 inline-flex items-center gap-2 gold-line-strong bg-ivory px-4 py-2">
              <Certificate size={15} weight="duotone" className="text-gold-soft" />
              <span className="text-[11px] uppercase tracking-widest text-ink-muted">Order</span>
              <span className="font-mono text-sm text-maroon-deep">#{shortId}</span>
            </div>
          )}
        </motion.div>

        {/* ── Order summary (if it belongs to this signed-in user) ── */}
        {order && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.6 }}
            className="mt-10 gold-line bg-ivory p-6 text-left"
            data-testid="confirm-order-summary"
          >
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Order summary</div>
              <div className="text-[10px] uppercase tracking-widest text-verified inline-flex items-center gap-1">
                <ShieldCheck size={12} weight="duotone" /> {order.status || "confirmed"}
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {(order.items || []).map((li, i) => (
                <div key={li.line_id || i} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <Package size={14} weight="duotone" className="text-gold-soft shrink-0" />
                    <span className="truncate">
                      {li.name}{li.qty > 1 ? ` × ${li.qty}` : ""}
                      {describeOptions(li.options_list) && (
                        <span className="block text-xs text-ink-muted">{describeOptions(li.options_list)}</span>
                      )}
                    </span>
                  </span>
                  <span className="font-mono text-ink-soft shrink-0">{formatINR(li.price * li.qty)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-gold/30 flex items-baseline justify-between">
              <span className="text-sm text-ink-soft">Total paid</span>
              <span className="font-display text-2xl text-maroon-deep">{formatINR(order.total)}</span>
            </div>
            {order.shipping?.shipping_city && (
              <div className="mt-3 text-xs text-ink-muted flex items-center gap-1">
                <Truck size={13} weight="duotone" /> Shipping to {order.shipping.shipping_city}
                {order.shipping.shipping_state ? `, ${order.shipping.shipping_state}` : ""}
              </div>
            )}
            {order.estimated_delivery_date && (
              <div className="mt-1 text-xs text-ink-muted flex items-center gap-1">
                <Truck size={13} weight="duotone" /> Est. delivery by {new Date(order.estimated_delivery_date).toLocaleDateString()}
              </div>
            )}
          </motion.div>
        )}

        {/* ── What happens next ── */}
        <div className="mt-12">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">What happens next</div>
          <div className="mt-6 grid md:grid-cols-3 gap-4 text-left">
            {STEPS.map(({ Icon, title, body }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 + i * 0.12, duration: 0.5 }}
                className="gold-line bg-ivory p-5 relative hover-lift"
              >
                <div className="absolute -top-3 left-5 brand-gradient text-ivory text-[10px] tracking-widest px-2 py-0.5 uppercase font-mono">
                  Step {i + 1}
                </div>
                <Icon size={26} weight="duotone" className="text-gold-soft mt-2" />
                <div className="font-serifd text-lg text-maroon-deep mt-2">{title}</div>
                <p className="text-sm text-ink-soft mt-1 leading-relaxed">{body}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── CTAs ── */}
        <div className="mt-12 flex flex-wrap gap-4 justify-center">
          <Link
            to="/account"
            data-testid="confirm-view-orders"
            className="brand-gradient text-ivory px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover-lift"
          >
            <Package size={16} weight="duotone" /> View my orders
          </Link>
          <Link
            to="/shop"
            className="border border-maroon text-maroon px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover:bg-maroon hover:text-ivory transition-colors"
          >
            Continue shopping <ArrowRight size={16} />
          </Link>
        </div>
        <Link
          to="/verify"
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-maroon underline underline-offset-4 decoration-gold-soft hover:text-maroon-deep"
        >
          <QrCode size={14} weight="duotone" /> Verify a certificate
        </Link>

        {/* blessing */}
        <div className="mt-12 flex items-center justify-center gap-3 text-ink-muted">
          <Sparkle size={14} weight="duotone" className="text-gold-soft" />
          <span className="font-deva text-lg text-gold-soft">शुभम् भवतु</span>
          <Sparkle size={14} weight="duotone" className="text-gold-soft" />
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-widest text-ink-muted">May it bring you auspiciousness</div>
      </div>
    </section>
  );
}
