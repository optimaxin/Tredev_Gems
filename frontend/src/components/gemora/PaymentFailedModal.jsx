import React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { XCircle, ArrowClockwise, EnvelopeSimple, X } from "@phosphor-icons/react";

/**
 * Shared "payment failed" overlay for both order checkout and consultation
 * booking — same recovery pattern either way: retry immediately, or reach
 * support if it keeps failing. Nothing here navigates away, so the buyer's
 * cart/form state (owned by the caller) survives a failed attempt.
 */
export default function PaymentFailedModal({ open, reason, onRetry, onClose }) {
  const reduce = useReducedMotion();
  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="payment-failed-modal">
        <motion.div
          initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-maroon-deep/70 backdrop-blur-sm" onClick={onClose}
        />
        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.92, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="relative bg-ivory gold-line-strong w-full max-w-sm p-8 text-center shadow-2xl"
        >
          <button onClick={onClose} aria-label="Close" data-testid="payment-failed-close"
                  className="absolute top-3 right-3 text-ink-muted hover:text-maroon focus-visible:ring-2 focus-visible:ring-gold/50">
            <X size={18} weight="bold" />
          </button>

          <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center"
               style={{ background: "radial-gradient(circle, rgba(183,28,28,0.15) 0%, rgba(183,28,28,0.05) 70%)" }}>
            <XCircle size={40} weight="fill" className="text-revoked" />
          </div>

          <h2 className="mt-5 font-display text-2xl text-ink">Payment failed</h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed" role="alert">
            {reason || "Your payment couldn't be completed. No amount was deducted — please try again."}
          </p>

          <button
            onClick={onRetry}
            data-testid="payment-failed-retry"
            className="mt-6 w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift focus-visible:ring-2 focus-visible:ring-gold/50"
          >
            <ArrowClockwise size={15} weight="bold" /> Try again
          </button>
          <a
            href="mailto:hello@gemora.in"
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-maroon"
          >
            <EnvelopeSimple size={13} weight="duotone" /> Still stuck? Contact support
          </a>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
