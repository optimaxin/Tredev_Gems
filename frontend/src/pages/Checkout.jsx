import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { getAffiliateRef } from "@/components/gemora/AffiliateTracker";
import { toast } from "sonner";
import { CheckCircle } from "@phosphor-icons/react";
import OrderTruckButton from "@/components/gemora/OrderTruckButton";
import PaymentFailedModal from "@/components/gemora/PaymentFailedModal";
import { openCashfreeCheckout } from "@/lib/cashfree";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { SHIPPING_REGIONS } from "@/lib/shipping";

export default function Checkout() {
  const { cart, refresh, subtotal } = useCart();
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  // idle → loading (collecting payment) → delivering (truck plays, then we navigate)
  const [phase, setPhase] = useState("idle");
  const [credit, setCredit] = useState(null); // { available, amount, expires_at }
  const [failed, setFailed] = useState({ open: false, reason: null });

  useEffect(() => {
    if (user) api.get("/me/consultation-credit").then((r) => setCredit(r.data)).catch(() => {});
  }, [user]);

  // Buying requires an account — bounce anyone who lands here directly (e.g. a
  // bookmarked/typed /checkout URL) back to login instead of showing the form.
  // The backend enforces this too (POST /checkout requires auth either way).
  useEffect(() => {
    if (!authLoading && !user) nav("/login", { state: { from: "/cart" }, replace: true });
  }, [authLoading, user, nav]);
  const [form, setForm] = useState({
    shipping_name: "", shipping_phone: "", shipping_address: "",
    shipping_city: "", shipping_state: "", shipping_pincode: "", email: "",
    shipping_region: "", // required for a USD (outside-India) checkout only
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const currency = cart.currency || "INR";
  const gst = Math.round(subtotal * 0.03);
  // A credit only applies when it matches this cart's currency (server enforces the
  // same rule at /checkout — see checkout()'s credit_usable) — a ₹ credit can't
  // discount a $ order or vice versa, so it just stays available for later instead.
  const creditUsable = credit?.available && (credit.currency || "INR") === currency;
  const discount = creditUsable ? Math.min(credit.amount, subtotal) : 0;
  const total = subtotal + gst - discount;
  const DELIVER_MS = 4200; // matches the truck animation length

  // Payment is confirmed by here — play the delivery truck, then leave for the
  // confirmation page. This is the ONLY place the animation starts.
  const deliverAndGo = async (orderId) => {
    try { await refresh(); } catch (_) {}
    setPhase("delivering");
    await new Promise((r) => setTimeout(r, DELIVER_MS));
    nav(`/order-confirmed/${orderId}`);
  };

  const placeOrder = async () => {
    if (phase !== "idle") return;
    setPhase("loading"); // "Processing…" while we collect payment — no truck yet
    try {
      const affiliate_ref = getAffiliateRef();
      const { data } = await api.post("/checkout", { ...form, affiliate_ref });

      // Test mode (no live keys configured on the server): complete server-side.
      if (data.order.mock_payment || (!data.payment_session_id && !data.razorpay)) {
        await api.post(`/checkout/mock-pay/${data.order.order_id}`);
        toast.success("Payment complete (test mode)");
        await deliverAndGo(data.order.order_id);
        return;
      }

      let verifyBody = { order_id: data.order.order_id };
      if (data.razorpay) {
        // International (non-INR) order — Razorpay, unlike Cashfree, hands back a
        // signed payment/order/signature triple on success. The backend still
        // verifies that signature itself before treating payment as confirmed.
        try {
          const rzp = await openRazorpayCheckout({
            keyId: data.razorpay.key_id, amount: data.razorpay.amount, currency: data.razorpay.currency,
            orderId: data.razorpay.order_id, name: form.shipping_name, email: form.email,
            contact: form.shipping_phone,
          });
          verifyBody = {
            ...verifyBody,
            razorpay_payment_id: rzp.razorpay_payment_id,
            razorpay_signature: rzp.razorpay_signature,
          };
        } catch (err) {
          toast.error(err.message || "Could not load the payment gateway");
          setPhase("idle");
          return;
        }
      } else {
        // Cashfree gives no client-side success/failure signal of its own: the
        // modal's promise just resolves once the buyer is done with it either way,
        // so /verify (which asks Cashfree directly) is what actually decides what
        // happened next.
        try {
          await openCashfreeCheckout(data.payment_session_id);
        } catch (err) {
          toast.error(err.message || "Could not load the payment gateway");
          setPhase("idle");
          return;
        }
      }
      try {
        await api.post("/checkout/verify", verifyBody);
      } catch (err) {
        setFailed({ open: true, reason: "We couldn't confirm this payment. If any amount was deducted, it will be refunded within 5-7 business days." });
        setPhase("idle");
        return;
      }
      toast.success("Payment verified");
      await deliverAndGo(data.order.order_id); // ← truck plays now, after paying
    } catch (err) {
      toast.error(err.response?.data?.detail || "Checkout failed");
      setPhase("idle");
    }
  };

  const place = (e) => { e.preventDefault(); placeOrder(); };

  if (authLoading || !user) return null; // redirecting to /login
  if (!cart.items?.length) return <div className="p-16 text-center">Your cart is empty.</div>;

  return (
    <div className="mx-auto max-w-5xl px-6 lg:px-10 py-16">
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Secure checkout</div>
      <h1 className="font-display text-4xl md:text-5xl text-ink mt-3">Complete your purchase</h1>

      <form onSubmit={place} className="mt-10 grid lg:grid-cols-[1fr_360px] gap-10">
        <div className="gold-line bg-ivory p-8 space-y-4">
          <div className="text-xs uppercase tracking-widest text-ink-muted">Delivery</div>
          {[
            ["shipping_name", "Full name"],
            ["email", "Email"],
            ["shipping_phone", "Phone"],
            ["shipping_address", "Address"],
            ["shipping_city", "City"],
            ["shipping_state", "State"],
            ["shipping_pincode", "PIN code"],
          ].map(([k, l]) => (
            <label key={k} className="block">
              <div className="text-xs text-ink-muted mb-1">{l}</div>
              <input
                required
                data-testid={`checkout-${k}`}
                value={form[k]}
                onChange={set(k)}
                type={k === "email" ? "email" : "text"}
                className="w-full gold-line bg-ivory px-4 py-3 outline-none focus:border-maroon"
              />
            </label>
          ))}
          {currency === "USD" && (
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Shipping region</div>
              <select
                required
                data-testid="checkout-shipping_region"
                value={form.shipping_region}
                onChange={set("shipping_region")}
                className="w-full gold-line bg-ivory px-4 py-3 outline-none focus:border-maroon"
              >
                <option value="" disabled>Select your region…</option>
                {SHIPPING_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}
        </div>

        <aside className="gold-line-strong bg-cream p-6 h-fit">
          <div className="text-xs uppercase tracking-widest text-ink-muted">Payment</div>
          <div className="mt-4 space-y-3">
            {cart.items.map((li) => (
              <div key={li.line_id} className="flex justify-between text-sm">
                <span className="truncate max-w-[200px]">{li.name}</span>
                <span className="font-mono">{formatPrice(li.price * li.qty, currency)}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-gold/40 flex justify-between text-sm">
            <span>GST</span><span>{formatPrice(gst, currency)}</span>
          </div>
          {currency === "USD" && (
            <div className="mt-2 flex justify-between text-sm text-ink-muted">
              <span>Shipping</span><span>Added for your region above</span>
            </div>
          )}
          {discount > 0 && (
            <div className="mt-2 flex justify-between text-sm text-verified">
              <span>Consultation credit</span><span>−{formatPrice(discount, currency)}</span>
            </div>
          )}
          <div className="mt-4 flex items-baseline justify-between">
            <span>{currency === "USD" ? "Total (+ shipping)" : "Total"}</span>
            <span className="font-display text-3xl text-maroon-deep">{formatPrice(total, currency)}</span>
          </div>
          <div className="mt-6">
            <OrderTruckButton
              type="submit"
              state={phase}
              duration={DELIVER_MS}
              data-testid="checkout-place-order"
              idleLabel="Pay securely"
              loadingLabel="Processing…"
              successLabel="On its way"
            />
          </div>
          <div className="mt-3 text-[11px] text-ink-muted flex items-center gap-1">
            <CheckCircle size={12} weight="duotone" className="text-verified" /> If the payment gateway is not configured on the server, a test-mode payment completes the order.
          </div>
        </aside>
      </form>

      <PaymentFailedModal
        open={failed.open}
        reason={failed.reason}
        onClose={() => setFailed({ open: false, reason: null })}
        onRetry={() => { setFailed({ open: false, reason: null }); placeOrder(); }}
      />
    </div>
  );
}
