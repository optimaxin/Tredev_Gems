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
import PaymentGatewayOverlay from "@/components/gemora/PaymentGatewayOverlay";
import { openCashfreeCheckout } from "@/lib/cashfree";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { SHIPPING_COUNTRIES, regionForCountry } from "@/lib/shipping";
import CouponBox, { CouponLines } from "@/components/gemora/CouponBox";

export default function Checkout() {
  const { cart, refresh, subtotal, coupons, manualCode } = useCart();
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
    shipping_country: "", // required for a USD (outside-India) checkout only
    buyer_gstin: "", // optional — a B2B tax invoice; business name comes from Cashfree, never typed
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [gstOpen, setGstOpen] = useState(false);
  // "" | "verifying" | "verified" | "failed" — mirrors .claude/gst_verification.md §6.2.
  // The business name is only ever set from a successful /gstin/verify response.
  const [gstinStatus, setGstinStatus] = useState("");
  const [gstinError, setGstinError] = useState("");
  const [businessName, setBusinessName] = useState("");
  const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  const gstinFormatValid = GSTIN_RE.test(form.buyer_gstin);

  const verifyGstin = async () => {
    setGstinStatus("verifying");
    setGstinError("");
    try {
      const { data } = await api.post("/gstin/verify", { gstin: form.buyer_gstin });
      if (data.verified) {
        setBusinessName(data.businessName);
        setGstinStatus("verified");
      } else {
        setGstinStatus("failed");
        setGstinError(data.message || "We couldn't verify this GSTIN.");
      }
    } catch (e) {
      setGstinStatus("failed");
      setGstinError(e?.response?.data?.detail || "We couldn't verify this GSTIN.");
    }
  };
  const [pinLookup, setPinLookup] = useState("");  // "", "loading", "ok", "notfound"
  const currency = cart.currency || "INR";

  // A full postal code fills City/State for the buyer. Wrong city/state on an
  // otherwise valid PIN is a common cause of failed deliveries, so this is about
  // accuracy as much as convenience. Resolved server-side (see backend/geo.py) —
  // the Amazon Location key is never exposed to the browser.
  const pincode = form.shipping_pincode;
  const pinCountry = currency === "INR" ? "IND" : (form.shipping_country || "");
  useEffect(() => {
    const code = (pincode || "").trim();
    // India is always 6 digits; elsewhere postal codes vary, so just require enough
    // characters to be plausible rather than encoding every country's format.
    const ready = pinCountry === "IND" ? /^\d{6}$/.test(code) : code.length >= 3;
    if (!ready) { setPinLookup(""); return undefined; }
    let cancelled = false;
    setPinLookup("loading");
    // Debounced: the field fires per keystroke and each miss costs a paid AWS call.
    const t = setTimeout(() => {
      api.get(`/geo/pincode/${encodeURIComponent(code)}`, { params: pinCountry ? { country: pinCountry } : {} })
        .then(({ data }) => {
          if (cancelled) return;
          if (!data?.found) { setPinLookup("notfound"); return; }
          setPinLookup("ok");
          setForm((f) => ({
            ...f,
            shipping_city: data.city || f.shipping_city,
            shipping_state: data.state || f.shipping_state,
          }));
        })
        .catch(() => { if (!cancelled) setPinLookup(""); });  // silent: manual entry still works
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pincode, pinCountry]);
  // The buyer picks their exact country (far less error-prone than asking them to
  // self-classify into a region), which resolves to one of the admin's coarse
  // shipping regions — same resolution the backend does server-side, so the total
  // shown here matches exactly what the gateway ends up charging in one go.
  const shippingRegion = form.shipping_country ? regionForCountry(form.shipping_country) : null;
  // Mirrors the backend's /checkout shipping_total: one distinct product in the
  // cart can carry its own USD shipping charge per region, summed once per product
  // (not per unit/qty or per options-line).
  const shippingTotal = currency === "USD" && shippingRegion
    ? [...new Map(cart.items.map((li) => [li.product_id, li])).values()].reduce((sum, li) => {
        const charge = (li.shipping_charges || {})[shippingRegion];
        return charge ? sum + Math.round(Number(charge) * 100) : sum;
      }, 0)
    : 0;
  // A credit only applies when it matches this cart's currency (server enforces the
  // same rule at /checkout — see checkout()'s credit_usable) — a ₹ credit can't
  // discount a $ order or vice versa, so it just stays available for later instead.
  const creditUsable = credit?.available && (credit.currency || "INR") === currency;
  const discount = creditUsable ? Math.min(credit.amount, subtotal) : 0;
  // Coupon totals come from the server (GET /coupons/auto-apply · POST
  // /coupons/validate). A free_shipping coupon is valued at 0 in that preview —
  // shipping isn't known until a country is picked — so the waiver is applied to
  // the shipping line here instead. /checkout recomputes all of this server-side
  // and that figure, not this one, is what the gateway is asked to charge.
  const couponDiscount = coupons.total_discount || 0;
  const effectiveShipping = coupons.free_shipping ? 0 : shippingTotal;
  // GST is added on top of each item's price using its own rate (set under
  // Admin -> Products) — mirrors backend's /checkout, which is what actually
  // charges the gateway. Exports (USD) are zero-rated, same as server-side.
  // ponytail: not discount-apportioned like the invoice engine — a few paise off
  // under a big coupon is fine for a live preview; /checkout's own total (and the
  // gateway's own confirmation screen) is what's actually charged.
  const gst = currency === "INR"
    ? cart.items.reduce((sum, li) => sum + Math.round((li.price * li.qty * (li.gst_rate_bp || 0)) / 10000), 0)
    : 0;
  const total = Math.max(0, subtotal + gst + effectiveShipping - discount - couponDiscount);
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
      // Only the typed code is sent. Auto-applied coupons are deliberately NOT —
      // the server finds those itself, so a tampered list can't buy a discount.
      const { data } = await api.post("/checkout", { ...form, affiliate_ref, coupon_code: manualCode || null });

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
            // PIN before City/State: entering it fills those two, so it has to come
            // first for the autofill to feel like part of the flow.
            ["shipping_pincode", "PIN code"],
            ["shipping_city", "City"],
            ["shipping_state", "State"],
          ].map(([k, l]) => (
            <label key={k} className="block">
              <div className="text-xs text-ink-muted mb-1 flex items-center gap-2">
                {l}
                {k === "shipping_pincode" && pinLookup === "loading" && <span className="text-[10px] text-ink-muted">looking up…</span>}
                {k === "shipping_pincode" && pinLookup === "notfound" && <span className="text-[10px] text-revoked">not found — enter city &amp; state manually</span>}
                {k === "shipping_pincode" && pinLookup === "ok" && <span className="text-[10px] text-verified inline-flex items-center gap-1"><CheckCircle size={11} weight="fill" /> city &amp; state filled</span>}
              </div>
              <input
                required
                data-testid={`checkout-${k}`}
                value={form[k]}
                onChange={set(k)}
                type={k === "email" ? "email" : "text"}
                inputMode={k === "shipping_pincode" ? "numeric" : undefined}
                className="w-full gold-line bg-ivory px-4 py-3 outline-none focus:border-maroon"
              />
            </label>
          ))}
          {currency === "USD" && (
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Shipping country</div>
              <select
                required
                data-testid="checkout-shipping_country"
                value={form.shipping_country}
                onChange={set("shipping_country")}
                className="w-full gold-line bg-ivory px-4 py-3 outline-none focus:border-maroon"
              >
                <option value="" disabled>Select your country…</option>
                {SHIPPING_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </label>
          )}

          <div className="pt-2">
            <button
              type="button"
              data-testid="checkout-gst-toggle"
              // Collapsing clears both so the order goes back to being a plain B2C one.
              onClick={() => {
                setGstOpen((o) => !o);
                if (gstOpen) {
                  setForm((f) => ({ ...f, buyer_gstin: "" }));
                  setGstinStatus(""); setGstinError(""); setBusinessName("");
                }
              }}
              className="text-xs text-ink-muted underline underline-offset-4 hover:text-maroon"
            >
              Have a GST number? (optional)
            </button>
          </div>
          {gstOpen && (
            <>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1 flex items-center gap-2">
                  GST Number (GSTIN)
                  {form.buyer_gstin && !gstinFormatValid && (
                    <span className="text-[10px] text-revoked">a GSTIN is 15 characters</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    data-testid="checkout-buyer_gstin"
                    value={form.buyer_gstin}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, buyer_gstin: e.target.value.toUpperCase() }));
                      if (gstinStatus) { setGstinStatus(""); setGstinError(""); setBusinessName(""); }
                    }}
                    readOnly={gstinStatus === "verifying" || gstinStatus === "verified"}
                    type="text"
                    maxLength={15}
                    placeholder="09AAECO5418P1ZV"
                    className="flex-1 gold-line bg-ivory px-4 py-3 outline-none focus:border-maroon disabled:opacity-60"
                  />
                  {gstinStatus === "verified" ? (
                    <span className="inline-flex items-center gap-1 px-3 text-xs text-green-700 whitespace-nowrap">
                      <CheckCircle size={16} weight="fill" /> Verified
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid="checkout-gstin-verify"
                      onClick={verifyGstin}
                      disabled={!gstinFormatValid || gstinStatus === "verifying"}
                      className="px-4 py-2 text-xs uppercase tracking-widest gold-line hover:border-maroon disabled:opacity-40 whitespace-nowrap"
                    >
                      {gstinStatus === "verifying" ? "Verifying…" : gstinStatus === "failed" ? "Retry" : "Verify"}
                    </button>
                  )}
                </div>
                {gstinStatus === "verified" && (
                  <button
                    type="button"
                    data-testid="checkout-gstin-change"
                    onClick={() => { setGstinStatus(""); setGstinError(""); setBusinessName(""); }}
                    className="mt-1 text-[11px] text-maroon underline underline-offset-4"
                  >
                    Change GSTIN
                  </button>
                )}
                {gstinStatus === "failed" && gstinError && (
                  <div className="mt-1 text-[11px] text-revoked">{gstinError}</div>
                )}
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Registered Business Name</div>
                <input
                  data-testid="checkout-buyer_legal_name"
                  value={businessName}
                  disabled
                  readOnly
                  placeholder="Auto-filled after GSTIN verification"
                  type="text"
                  className="w-full gold-line bg-cream/60 px-4 py-3 outline-none text-ink-muted disabled:opacity-70"
                />
              </label>
              <div className="text-[11px] text-ink-muted">
                Verify your GSTIN to put it on the tax invoice so the business can claim input tax credit.
                {gstinStatus !== "verified" && " Unverified GST numbers aren't added to the order."}
              </div>
            </>
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
          <div className="mt-5 pt-4 border-t border-gold/40">
            <CouponBox currency={currency} />
          </div>

          <div className="mt-5 pt-4 border-t border-gold/40 space-y-2">
            {currency === "USD" && (
              <div className="flex justify-between text-sm text-ink-muted">
                <span>Shipping</span>
                <span>
                  {!shippingRegion ? "Select your country above"
                    : coupons.free_shipping ? <span className="text-verified">Free</span>
                    : formatPrice(shippingTotal, currency)}
                </span>
              </div>
            )}
            <CouponLines currency={currency} />
            {gst > 0 && (
              <div className="flex justify-between text-sm text-ink-muted">
                <span>GST</span><span>{formatPrice(gst, currency)}</span>
              </div>
            )}
            {discount > 0 && (
              <div className="flex justify-between text-sm text-verified">
                <span>Consultation credit</span><span>−{formatPrice(discount, currency)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <span>Total</span>
              <span className="font-display text-3xl text-maroon-deep">{formatPrice(total, currency)}</span>
            </div>
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

      <PaymentGatewayOverlay open={phase === "loading"} />

      <PaymentFailedModal
        open={failed.open}
        reason={failed.reason}
        onClose={() => setFailed({ open: false, reason: null })}
        onRetry={() => { setFailed({ open: false, reason: null }); placeOrder(); }}
      />
    </div>
  );
}
