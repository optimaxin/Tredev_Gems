import React from "react";
import { Link } from "react-router-dom";
import { X } from "@phosphor-icons/react";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { describeOptions } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { ShieldCheck, TrashSimple, ShoppingBag, LockKey } from "@phosphor-icons/react";
import { toast } from "sonner";
import AsyncButton from "@/components/gemora/AsyncButton";

export default function CartDrawer({ open, onClose }) {
  const { cart, remove, subtotal } = useCart();
  const { user } = useAuth();
  const items = cart.items || [];
  const currency = cart.currency || "INR";
  const [busyLine, setBusyLine] = React.useState(null);

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
    <>
      <div
        className={`fixed inset-0 bg-maroon-deep/50 backdrop-blur-sm z-50 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        style={{ transition: "opacity 200ms ease" }}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 right-0 bottom-0 w-full sm:w-[440px] bg-ivory z-50 border-l border-gold-soft/50 flex flex-col ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{ transition: "transform 260ms cubic-bezier(.4,0,.2,1)" }}
        data-testid="cart-drawer"
      >
        <div className="p-6 border-b border-gold/30 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Reserved for you</div>
            <div className="font-display text-3xl text-maroon-deep mt-1">Cart</div>
          </div>
          <button onClick={onClose} data-testid="cart-drawer-close" className="text-ink-muted hover:text-maroon">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="text-center text-ink-muted pt-20">
              <div>Nothing reserved yet.</div>
              <Link to="/shop" onClick={onClose} className="mt-3 inline-block text-maroon underline underline-offset-4 decoration-gold-soft">Browse the store →</Link>
            </div>
          ) : items.map((li) => (
            <div key={li.line_id} className="gold-line bg-ivory p-3 flex gap-3 items-center mb-3">
              <div className="w-16 h-16 gold-line overflow-hidden shrink-0">
                {li.image && <img src={li.image} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-serifd text-base truncate">{li.name}</div>
                <div className="mt-1 text-[10px] text-ink-muted">Qty {li.qty}</div>
                {describeOptions(li.options_list) && (
                  <div className="text-[10px] text-ink-muted">{describeOptions(li.options_list)}</div>
                )}
                <div className="text-xs text-maroon-deep mt-1">{formatPrice(li.price * li.qty, currency)}</div>
              </div>
              <AsyncButton onClick={() => removeLine(li.line_id)} loading={busyLine === li.line_id} loadingText=""
                aria-label="Remove item" className="text-ink-muted hover:text-revoked">
                <TrashSimple size={16} />
              </AsyncButton>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <div className="p-6 border-t border-gold/30 bg-cream">
            {user ? (
              <>
                <div className="flex justify-between items-baseline">
                  <span className="text-sm">Subtotal</span>
                  <span className="font-display text-2xl text-maroon-deep">{formatPrice(subtotal, currency)}</span>
                </div>
                <Link
                  to="/cart"
                  onClick={onClose}
                  data-testid="cart-drawer-view"
                  className="mt-4 w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover-lift"
                >
                  <ShoppingBag size={16} weight="duotone" /> View cart & checkout
                </Link>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm text-ink-soft">
                  <LockKey size={16} weight="duotone" className="text-gold-soft shrink-0" />
                  Log in to see your total and check out.
                </div>
                <Link
                  to="/login"
                  state={{ from: "/cart" }}
                  onClick={onClose}
                  data-testid="cart-drawer-login"
                  className="mt-4 w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover-lift"
                >
                  Log in to continue
                </Link>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
