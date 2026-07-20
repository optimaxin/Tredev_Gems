import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatINR } from "@/lib/api";
import { useCart } from "@/context/CartContext";
import { getAffiliateRef } from "@/components/gemora/AffiliateTracker";
import { toast } from "sonner";
import { CheckCircle } from "@phosphor-icons/react";
import OrderTruckButton from "@/components/gemora/OrderTruckButton";

export default function Checkout() {
  const { cart, refresh, subtotal } = useCart();
  const nav = useNavigate();
  // idle → loading (collecting payment) → delivering (truck plays, then we navigate)
  const [phase, setPhase] = useState("idle");
  const [form, setForm] = useState({
    shipping_name: "", shipping_phone: "", shipping_address: "",
    shipping_city: "", shipping_state: "", shipping_pincode: "", email: "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const total = subtotal + Math.round(subtotal * 0.03);
  const DELIVER_MS = 4200; // matches the truck animation length

  // Payment is confirmed by here — play the delivery truck, then leave for the
  // confirmation page. This is the ONLY place the animation starts.
  const deliverAndGo = async (orderId) => {
    try { await refresh(); } catch (_) {}
    setPhase("delivering");
    await new Promise((r) => setTimeout(r, DELIVER_MS));
    nav(`/order-confirmed/${orderId}`);
  };

  const place = async (e) => {
    e.preventDefault();
    if (phase !== "idle") return;
    setPhase("loading"); // "Processing…" while we collect payment — no truck yet
    try {
      const affiliate_ref = getAffiliateRef();
      const { data } = await api.post("/checkout", { ...form, affiliate_ref });

      // Test mode (Razorpay keys not configured on the server): complete server-side.
      if (data.order.mock_payment || !data.razorpay_key_id) {
        await api.post(`/checkout/mock-pay/${data.order.order_id}`);
        toast.success("Payment complete (test mode)");
        await deliverAndGo(data.order.order_id);
        return;
      }

      // Real Razorpay — open the checkout to collect payment. The truck only plays
      // after the payment is verified in the handler below.
      const options = {
        key: data.razorpay_key_id,
        amount: data.order.total,
        currency: "INR",
        name: "Tredev",
        description: "Serialized authentic goods",
        order_id: data.order.razorpay_order_id,
        prefill: { name: form.shipping_name, email: form.email, contact: form.shipping_phone },
        theme: { color: "#722F37" },
        handler: async (rp) => {
          try {
            await api.post("/checkout/verify", {
              order_id: data.order.order_id,
              razorpay_order_id: rp.razorpay_order_id,
              razorpay_payment_id: rp.razorpay_payment_id,
              razorpay_signature: rp.razorpay_signature,
            });
          } catch (err) {
            toast.error("Payment verification failed");
            setPhase("idle");
            return;
          }
          toast.success("Payment verified");
          await deliverAndGo(data.order.order_id); // ← truck plays now, after paying
        },
        // Buyer closed the Razorpay window without paying — reset the button.
        modal: { ondismiss: () => setPhase("idle") },
      };

      const openRzp = () => new window.Razorpay(options).open();
      if (!window.Razorpay) {
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.onload = openRzp;
        s.onerror = () => { toast.error("Could not load the payment gateway"); setPhase("idle"); };
        document.body.appendChild(s);
      } else {
        openRzp();
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Checkout failed");
      setPhase("idle");
    }
  };

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
        </div>

        <aside className="gold-line-strong bg-cream p-6 h-fit">
          <div className="text-xs uppercase tracking-widest text-ink-muted">Payment</div>
          <div className="mt-4 space-y-3">
            {cart.items.map((li) => (
              <div key={li.line_id} className="flex justify-between text-sm">
                <span className="truncate max-w-[200px]">{li.name}</span>
                <span className="font-mono">{formatINR(li.price * li.qty)}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-gold/40 flex justify-between text-sm">
            <span>GST</span><span>{formatINR(Math.round(subtotal * 0.03))}</span>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span>Total</span>
            <span className="font-display text-3xl text-maroon-deep">{formatINR(total)}</span>
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
            <CheckCircle size={12} weight="duotone" className="text-verified" /> If Razorpay is not configured on the server, a test-mode payment completes the order.
          </div>
        </aside>
      </form>
    </div>
  );
}
