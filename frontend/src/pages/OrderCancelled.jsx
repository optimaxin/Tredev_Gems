import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import ProductCard from "@/components/gemora/ProductCard";
import {
  Package, ArrowRight, Sparkle, ArrowCounterClockwise, Wallet, ClockCountdown, Tag,
} from "@phosphor-icons/react";

const stepsFor = (refunded) => [
  refunded
    ? { Icon: Wallet, title: "Refund initiated", body: "We've already asked Cashfree to send your payment back to its original method." }
    : { Icon: Wallet, title: "Nothing was charged", body: "This order hadn't been paid for, so there's nothing to refund — you're all clear." },
  { Icon: ArrowCounterClockwise, title: "Stock released", body: "Any pieces reserved for this order are back in the vault, available for other buyers." },
  refunded
    ? { Icon: ClockCountdown, title: "A few days to land", body: "Refunds usually reflect in 5–7 business days, depending on your bank." }
    : { Icon: ClockCountdown, title: "Ready when you are", body: "Come back anytime — nothing further is needed to close this out." },
];

/* A slow drifting gold haze, calmer than the celebratory petals on the confirm page. */
function Haze({ reduce }) {
  if (reduce) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      style={{
        background:
          "radial-gradient(circle at 50% 0%, rgba(212,175,55,0.14) 0%, rgba(114,47,55,0.05) 45%, transparent 70%)",
      }}
    />
  );
}

export default function OrderCancelled() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [picks, setPicks] = useState([]);
  const reduce = useReducedMotion();

  useEffect(() => {
    let alive = true;
    if (orderId) {
      api.get(`/orders/${orderId}`).then(({ data }) => alive && setOrder(data)).catch(() => {});
    }
    // A handful of genuinely discounted pieces — mrp > price — so this isn't a
    // dead end. Comfortably over-fetch since not every product carries a discount.
    api.get("/products?limit=40").then(({ data }) => {
      if (!alive) return;
      const discounted = (data || []).filter((p) => p.mrp && p.mrp > p.price);
      setPicks(discounted.slice(0, 4));
    }).catch(() => {});
    window.scrollTo(0, 0);
    return () => { alive = false; };
  }, [orderId]);

  const shortId = (orderId || "").slice(0, 8).toUpperCase();
  // A real (non-mock) payment that was actually captured is the one this order's
  // cancel flow would have refunded — order.status itself stays "cancelled", not
  // "refunded", so paid_at + mock_payment is the signal to read here.
  const refunded = Boolean(order?.paid_at && !order?.mock_payment);

  return (
    <section className="relative overflow-hidden bg-ivory geom-bg min-h-[92vh] flex items-center">
      <Haze reduce={reduce} />

      <div className="relative mx-auto max-w-3xl px-6 lg:px-10 py-20 text-center w-full">
        {/* ── Seal ── */}
        <div className="relative mx-auto w-40 h-40 flex items-center justify-center">
          {!reduce && (
            <div className="aura-ring absolute inset-0 rounded-full border border-gold/40" />
          )}
          <svg className="absolute inset-0 w-full h-full chakra-spin" viewBox="0 0 160 160" aria-hidden="true">
            <circle cx="80" cy="80" r="72" fill="none" stroke="#D4AF37" strokeWidth="1.5" strokeDasharray="2 8" opacity="0.6" />
            <circle cx="80" cy="80" r="63" fill="none" stroke="#C9A227" strokeWidth="1" opacity="0.35" />
          </svg>
          <div
            className="seal-pop relative w-28 h-28 rounded-full flex items-center justify-center shadow-[0_12px_40px_-10px_rgba(114,47,55,0.45)]"
            style={{ background: "linear-gradient(135deg, #8a4650 0%, #4E1F26 100%)" }}
          >
            <motion.svg width="48" height="48" viewBox="0 0 52 52" fill="none">
              <motion.path
                d="M16 16 L36 36 M36 16 L16 36"
                stroke="#FBFBF9" strokeWidth="4.5" strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ delay: 0.35, duration: 0.55, ease: "easeInOut" }}
              />
            </motion.svg>
          </div>
        </div>

        {/* ── Message ── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.6 }}>
          <div className="mt-8 font-deva text-3xl text-gold-soft">रद्द</div>
          <h1 className="mt-2 font-display text-5xl md:text-6xl leading-tight text-ink">
            Your order has been cancelled
          </h1>
          <p className="mt-5 text-base md:text-lg text-ink-soft leading-relaxed max-w-xl mx-auto">
            It's done — no further action needed on your end. If a payment was already
            made, the refund is on its way back to you.
          </p>

          {orderId && (
            <div className="mt-6 inline-flex items-center gap-2 gold-line-strong bg-ivory px-4 py-2">
              <Package size={15} weight="duotone" className="text-gold-soft" />
              <span className="text-[11px] uppercase tracking-widest text-ink-muted">Order</span>
              <span className="font-mono text-sm text-maroon-deep">#{shortId}</span>
            </div>
          )}
        </motion.div>

        {/* ── Order summary ── */}
        {order && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.6 }}
            className="mt-10 gold-line bg-ivory p-6 text-left"
            data-testid="cancelled-order-summary"
          >
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">What was cancelled</div>
              <div className="text-[10px] uppercase tracking-widest text-revoked inline-flex items-center gap-1">
                cancelled
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {(order.items || []).map((li, i) => (
                <div key={li.line_id || i} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <Package size={14} weight="duotone" className="text-gold-soft shrink-0" />
                    <span className="truncate">{li.name}{li.qty > 1 ? ` × ${li.qty}` : ""}</span>
                  </span>
                  <span className="font-mono text-ink-soft shrink-0">{formatINR(li.price * li.qty)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-gold/30 flex items-baseline justify-between">
              <span className="text-sm text-ink-soft">{refunded ? "Refund amount" : "Order value"}</span>
              <span className="font-display text-2xl text-maroon-deep">{formatPrice(order.total, order.currency)}</span>
            </div>
          </motion.div>
        )}

        {/* ── What happens next ── */}
        <div className="mt-12">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">What happens next</div>
          <div className="mt-6 grid md:grid-cols-3 gap-4 text-left">
            {stepsFor(refunded).map(({ Icon, title, body }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 + i * 0.12, duration: 0.5 }}
                className="gold-line bg-ivory p-5 relative hover-lift"
              >
                <Icon size={26} weight="duotone" className="text-gold-soft mt-2" />
                <div className="font-serifd text-lg text-maroon-deep mt-2">{title}</div>
                <p className="text-sm text-ink-soft mt-1 leading-relaxed">{body}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── A few pieces worth a second look, discounted ── */}
        {picks.length > 0 && (
          <div className="mt-16">
            <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-[0.3em] text-gold-soft">
              <Tag size={14} weight="duotone" /> While you're here — at a discount
            </div>
            <p className="mt-2 text-sm text-ink-muted">A few certified pieces currently priced below MRP.</p>
            <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-5 text-left">
              {picks.map((p) => <ProductCard key={p.product_id} p={p} />)}
            </div>
          </div>
        )}

        {/* ── CTA ── */}
        <div className="mt-12 flex flex-wrap gap-4 justify-center">
          <Link
            to="/shop"
            data-testid="cancelled-explore-more"
            className="brand-gradient text-ivory px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover-lift"
          >
            Explore more ranges <ArrowRight size={16} />
          </Link>
          <Link
            to="/account"
            className="border border-maroon text-maroon px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover:bg-maroon hover:text-ivory transition-colors"
          >
            View my orders
          </Link>
        </div>

        <div className="mt-12 flex items-center justify-center gap-3 text-ink-muted">
          <Sparkle size={14} weight="duotone" className="text-gold-soft" />
          <span className="font-deva text-lg text-gold-soft">फिर मिलेंगे</span>
          <Sparkle size={14} weight="duotone" className="text-gold-soft" />
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-widest text-ink-muted">We hope to serve you again soon</div>
      </div>
    </section>
  );
}
