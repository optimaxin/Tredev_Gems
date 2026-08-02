import React from "react";
import { LockKey } from "@phosphor-icons/react";

/**
 * Instant-feedback overlay shown the moment "Pay" is clicked — before the
 * backend has created the gateway order, so there'd otherwise be a visible gap
 * before Razorpay/Cashfree's own modal appears. Tied directly to the caller's
 * existing loading state (no new state of its own), so it appears on the same
 * tick as the click and is replaced by the real gateway modal once it's ready.
 */
export default function PaymentGatewayOverlay({ open, label = "Opening secure payment…" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/60 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="gold-line-strong bg-ivory px-10 py-8 flex flex-col items-center gap-4 text-center max-w-xs">
        <div className="relative flex items-center justify-center w-14 h-14">
          <span className="absolute inset-0 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
          <LockKey size={22} weight="duotone" className="text-maroon-deep" />
        </div>
        <div>
          <div className="font-display text-lg text-ink">{label}</div>
          <div className="text-xs text-ink-muted mt-1">Please don't close this tab.</div>
        </div>
      </div>
    </div>
  );
}
