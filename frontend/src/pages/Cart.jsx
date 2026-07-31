import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { describeOptions } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { TrashSimple, ShieldCheck, ShoppingBag, Plus, Minus, LockKey } from "@phosphor-icons/react";
import { toast } from "sonner";
import AsyncButton from "@/components/gemora/AsyncButton";

export default function Cart() {
  const { cart, remove, setQty, subtotal } = useCart();
  const { user } = useAuth();
  const nav = useNavigate();
  const items = cart.items || [];
  const currency = cart.currency || "INR";
  const [busyLine, setBusyLine] = React.useState(null);

  const changeQty = async (li, next) => {
    if (next < 1) return removeLine(li.line_id);
    setBusyLine(li.line_id);
    try {
      await setQty(li.line_id, next);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not update quantity");
    } finally {
      setBusyLine((b) => (b === li.line_id ? null : b));
    }
  };

  const removeLine = async (line_id) => {
    setBusyLine(line_id);
    try {
      await remove(line_id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not remove item");
    } finally {
      setBusyLine((b) => (b === line_id ? null : b));
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 lg:px-10 py-16">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Your reservation</div>
          <h1 className="font-display text-4xl md:text-5xl text-ink mt-3">Cart · टोकरी</h1>
        </div>
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
                    <AsyncButton
                      onClick={() => changeQty(li, li.qty - 1)}
                      loading={busyLine === li.line_id}
                      loadingText=""
                      data-testid={`cart-qty-dec-${li.line_id}`}
                      className="px-3 py-2 text-maroon hover:bg-ivory"
                      aria-label="Decrease quantity"
                    >
                      <Minus size={14} weight="bold" />
                    </AsyncButton>
                    <span className="px-4 py-2 font-display tabular-nums min-w-[2.5rem] text-center">{li.qty}</span>
                    <AsyncButton
                      onClick={() => changeQty(li, li.qty + 1)}
                      loading={busyLine === li.line_id}
                      loadingText=""
                      data-testid={`cart-qty-inc-${li.line_id}`}
                      className="px-3 py-2 text-maroon hover:bg-ivory"
                      aria-label="Increase quantity"
                    >
                      <Plus size={14} weight="bold" />
                    </AsyncButton>
                  </div>
                </div>
                <div className="font-display text-xl text-maroon-deep">{formatPrice(li.price * li.qty, currency)}</div>
                <AsyncButton onClick={() => removeLine(li.line_id)} loading={busyLine === li.line_id} loadingText=""
                  data-testid={`cart-remove-${li.line_id}`} className="text-ink-muted hover:text-revoked" aria-label="Remove item">
                  <TrashSimple size={20} />
                </AsyncButton>
              </div>
            ))}
          </div>

          <aside className="gold-line-strong bg-cream p-6 h-fit">
            <div className="text-xs uppercase tracking-widest text-ink-muted">Summary</div>
            {user ? (
              <>
                <div className="mt-4 flex items-baseline justify-between">
                  <span>Subtotal</span><span className="font-display text-xl">{formatPrice(subtotal, currency)}</span>
                </div>
                <div className="mt-2 flex items-baseline justify-between text-sm text-ink-muted">
                  <span>GST (3%)</span><span>{formatPrice(Math.round(subtotal * 0.03), currency)}</span>
                </div>
                <div className="mt-4 pt-4 border-t border-gold/40 flex items-baseline justify-between">
                  <span className="text-sm">Total</span>
                  <span className="font-display text-3xl text-maroon-deep">{formatPrice(subtotal + Math.round(subtotal * 0.03), currency)}</span>
                </div>
                <button
                  data-testid="cart-checkout-btn"
                  onClick={() => nav("/checkout")}
                  className="mt-6 w-full brand-gradient text-ivory py-4 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift"
                >
                  <ShoppingBag size={16} weight="duotone" /> Proceed to checkout
                </button>
                <div className="mt-4 text-xs text-ink-muted leading-relaxed">
                  Payments are processed through Cashfree. Your unique units are only marked "sold" after a payment Cashfree confirms as successful.
                </div>
              </>
            ) : (
              <div className="mt-4 text-center" data-testid="cart-login-gate">
                <LockKey size={28} weight="duotone" className="mx-auto text-gold-soft" />
                <p className="mt-3 text-sm text-ink-soft leading-relaxed">
                  Log in or create an account to see your order total and check out.
                </p>
                <Link
                  to="/login"
                  state={{ from: "/cart" }}
                  data-testid="cart-login-cta"
                  className="mt-5 w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift"
                >
                  Log in
                </Link>
                <Link
                  to="/signup"
                  state={{ from: "/cart" }}
                  className="mt-3 w-full border border-maroon text-maroon py-3 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:bg-maroon hover:text-ivory transition-colors"
                >
                  Create account
                </Link>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
