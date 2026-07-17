import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "@/context/CartContext";
import { formatINR, describeOptions } from "@/lib/api";
import { TrashSimple, ShieldCheck, ShoppingBag, Plus, Minus } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function Cart() {
  const { cart, remove, setQty, subtotal } = useCart();
  const nav = useNavigate();
  const items = cart.items || [];

  const changeQty = async (li, next) => {
    if (next < 1) return remove(li.line_id);
    try {
      await setQty(li.line_id, next);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not update quantity");
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 lg:px-10 py-16">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Your reservation</div>
          <h1 className="font-display text-4xl md:text-5xl text-ink mt-3">Cart · टोकरी</h1>
        </div>
        <div className="text-sm text-ink-muted">Reserved for 15 minutes</div>
      </div>

      {items.length === 0 ? (
        <div className="mt-12 gold-line p-16 text-center">
          <div className="text-ink-muted">Your cart is empty.</div>
          <Link to="/shop" className="mt-4 inline-block text-maroon underline underline-offset-4 decoration-gold-soft">Browse the store →</Link>
        </div>
      ) : (
        <div className="mt-10 grid lg:grid-cols-[1fr_360px] gap-10">
          <div className="space-y-4">
            {items.map((li) => (
              <div key={li.line_id} data-testid={`cart-line-${li.line_id}`} className="gold-line bg-ivory p-4 flex gap-5 items-center">
                <div className="w-24 h-24 overflow-hidden gold-line shrink-0">
                  {li.image && <img src={li.image} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1">
                  <div className="font-serifd text-xl text-ink">{li.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-verified">
                    <ShieldCheck size={12} weight="duotone" /> Certified pieces assigned at dispatch
                  </div>
                  {describeOptions(li.options_list) && (
                    <div className="mt-1 text-xs text-ink-muted">{describeOptions(li.options_list)}</div>
                  )}
                  <div className="mt-3 inline-flex items-center gold-line bg-cream">
                    <button
                      onClick={() => changeQty(li, li.qty - 1)}
                      data-testid={`cart-qty-dec-${li.line_id}`}
                      className="px-3 py-2 text-maroon hover:bg-ivory"
                      aria-label="Decrease quantity"
                    >
                      <Minus size={14} weight="bold" />
                    </button>
                    <span className="px-4 py-2 font-display tabular-nums min-w-[2.5rem] text-center">{li.qty}</span>
                    <button
                      onClick={() => changeQty(li, li.qty + 1)}
                      data-testid={`cart-qty-inc-${li.line_id}`}
                      className="px-3 py-2 text-maroon hover:bg-ivory"
                      aria-label="Increase quantity"
                    >
                      <Plus size={14} weight="bold" />
                    </button>
                  </div>
                </div>
                <div className="font-display text-xl text-maroon-deep">{formatINR(li.price * li.qty)}</div>
                <button onClick={() => remove(li.line_id)} data-testid={`cart-remove-${li.line_id}`} className="text-ink-muted hover:text-revoked">
                  <TrashSimple size={20} />
                </button>
              </div>
            ))}
          </div>

          <aside className="gold-line-strong bg-cream p-6 h-fit">
            <div className="text-xs uppercase tracking-widest text-ink-muted">Summary</div>
            <div className="mt-4 flex items-baseline justify-between">
              <span>Subtotal</span><span className="font-display text-xl">{formatINR(subtotal)}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between text-sm text-ink-muted">
              <span>GST (3%)</span><span>{formatINR(Math.round(subtotal * 0.03))}</span>
            </div>
            <div className="mt-4 pt-4 border-t border-gold/40 flex items-baseline justify-between">
              <span className="text-sm">Total</span>
              <span className="font-display text-3xl text-maroon-deep">{formatINR(subtotal + Math.round(subtotal * 0.03))}</span>
            </div>
            <button
              data-testid="cart-checkout-btn"
              onClick={() => nav("/checkout")}
              className="mt-6 w-full brand-gradient text-ivory py-4 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift"
            >
              <ShoppingBag size={16} weight="duotone" /> Proceed to checkout
            </button>
            <div className="mt-4 text-xs text-ink-muted leading-relaxed">
              Payments are processed through Razorpay. Your unique units are only marked "sold" after a signature-verified payment.
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
