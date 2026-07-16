import React from "react";
import { Link } from "react-router-dom";
import { X } from "@phosphor-icons/react";
import { useCart } from "@/context/CartContext";
import { formatINR } from "@/lib/api";
import { ShieldCheck, TrashSimple, ShoppingBag } from "@phosphor-icons/react";

export default function CartDrawer({ open, onClose }) {
  const { cart, remove, subtotal } = useCart();
  const items = cart.items || [];
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
                <div className="text-xs text-maroon-deep mt-1">{formatINR(li.price * li.qty)}</div>
              </div>
              <button onClick={() => remove(li.line_id)} className="text-ink-muted hover:text-revoked">
                <TrashSimple size={16} />
              </button>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <div className="p-6 border-t border-gold/30 bg-cream">
            <div className="flex justify-between items-baseline">
              <span className="text-sm">Subtotal</span>
              <span className="font-display text-2xl text-maroon-deep">{formatINR(subtotal)}</span>
            </div>
            <div className="text-xs text-ink-muted mt-1">GST added at checkout</div>
            <Link
              to="/cart"
              onClick={onClose}
              data-testid="cart-drawer-view"
              className="mt-4 w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover-lift"
            >
              <ShoppingBag size={16} weight="duotone" /> View cart & checkout
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
