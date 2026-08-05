import React, { useState } from "react";
import { useCart } from "@/context/CartContext";
import { formatPrice } from "@/lib/currency";
import { Tag, X, Sparkle, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";

// Auto-applied coupons need no input field — the buyer never typed them, so the
// banner is the whole interaction. The manual field sits BELOW it, per the spec's
// checkout layout, so the free discount reads as already-won rather than as one
// more thing to go hunting for.
export default function CouponBox({ currency = "INR", showInput = true }) {
  const { coupons, manualCode, applyCode, removeCode } = useCart();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const applied = coupons.applied || [];
  const auto = applied.filter((c) => c.auto);
  const typed = applied.filter((c) => !c.auto);
  const exclusive = applied.find((c) => !c.stackable);

  const submit = async (e) => {
    e.preventDefault();
    const next = code.trim();
    if (!next || busy) return;
    setBusy(true);
    try {
      await applyCode(next);
      setCode("");
      toast.success(`${next.toUpperCase()} applied`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "That code could not be applied");
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    setBusy(true);
    try { await removeCode(); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3" data-testid="coupon-box">
      {auto.length > 0 && (
        <div className="gold-line bg-ivory p-3 space-y-1" data-testid="coupon-auto-banner">
          {auto.map((c) => (
            <div key={c.code} className="flex items-center gap-2 text-sm text-verified">
              <Sparkle size={14} weight="fill" className="shrink-0" />
              <span className="flex-1">{c.name} applied automatically</span>
              {c.amount > 0 && (
                <span className="font-mono text-xs">−{formatPrice(c.amount, currency)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {typed.map((c) => (
        <div key={c.code} data-testid={`coupon-applied-${c.code}`}
             className="gold-line bg-ivory p-3 flex items-center gap-2 text-sm">
          <Tag size={14} weight="duotone" className="text-maroon shrink-0" />
          <span className="flex-1 truncate">
            <span className="font-mono uppercase">{c.code}</span>
            <span className="text-ink-muted"> · {c.name}</span>
          </span>
          {c.amount > 0 && (
            <span className="font-mono text-xs text-verified">−{formatPrice(c.amount, currency)}</span>
          )}
          <button type="button" onClick={drop} disabled={busy} aria-label={`Remove ${c.code}`}
                  data-testid="coupon-remove" className="text-ink-muted hover:text-revoked">
            <X size={14} weight="bold" />
          </button>
        </div>
      ))}

      {exclusive && applied.length > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-ink-muted leading-relaxed">
          <Warning size={13} weight="duotone" className="text-gold-soft shrink-0 mt-[1px]" />
          <span>{exclusive.code} cannot be combined with other offers.</span>
        </div>
      )}

      {showInput && !manualCode && (
        // Nested <form>s are invalid HTML and the checkout page is already one big
        // form, so this is a div that submits on Enter rather than a real <form>.
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}
            placeholder="Promo code"
            aria-label="Promo code"
            data-testid="coupon-input"
            className="flex-1 min-w-0 gold-line bg-ivory px-3 py-2 text-sm font-mono uppercase outline-none focus:border-maroon"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !code.trim()}
            data-testid="coupon-apply"
            className="px-4 py-2 text-xs uppercase tracking-widest border border-maroon text-maroon hover:bg-maroon hover:text-ivory transition-colors disabled:opacity-40"
          >
            {busy ? "…" : "Apply"}
          </button>
        </div>
      )}
    </div>
  );
}

// One line per coupon in the order summary — the spec is explicit that stacked
// discounts must not collapse into a single "discount" figure.
export function CouponLines({ currency = "INR" }) {
  const { coupons } = useCart();
  return (coupons.applied || [])
    .filter((c) => c.amount > 0)
    .map((c) => (
      <div key={c.code} className="flex justify-between text-sm text-verified"
           data-testid={`coupon-line-${c.code}`}>
        <span className="truncate max-w-[210px]">
          {c.discount_type === "percentage" ? `${c.code} (${c.discount_value}%)` : c.code}
        </span>
        <span>−{formatPrice(c.amount, currency)}</span>
      </div>
    ));
}
