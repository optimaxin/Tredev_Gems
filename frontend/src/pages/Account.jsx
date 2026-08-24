import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatINR, describeOptions, apiErrorMessage, mediaSrc, openInvoice } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { useAuth } from "@/context/AuthContext";
import { ShieldCheck, Package, Heart, Certificate as CertIcon, ArrowRight, Phone, WhatsappLogo, Gear, PencilSimple, LockKey, ChatCircleDots, CaretDown, CaretUp, MapPin, Calendar, VideoCamera, Wallet, XCircle } from "@phosphor-icons/react";
import PhoneVerify from "@/components/gemora/PhoneVerify";
import AccountSupport from "@/components/gemora/AccountSupport";
import OrderTracking from "@/components/gemora/OrderTracking";
import AsyncButton from "@/components/gemora/AsyncButton";
import { toast } from "sonner";
import { openCashfreeCheckout } from "@/lib/cashfree";
import { openRazorpayCheckout } from "@/lib/razorpay";
import PaymentGatewayOverlay from "@/components/gemora/PaymentGatewayOverlay";

export default function Account() {
  const { user, loading, refresh, patchUser } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState("vault");
  const [orders, setOrders] = useState([]);
  const [vault, setVault] = useState([]);
  const [wish, setWish] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [credit, setCredit] = useState(null);
  const [showVerify, setShowVerify] = useState(false);
  const [changingPhone, setChangingPhone] = useState(false);
  const [payingId, setPayingId] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [expandedOrder, setExpandedOrder] = useState(null);

  const loadOrders = () => api.get("/orders").then((r) => setOrders(r.data)).catch(() => {});

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/login"); return; }
    loadOrders();
    api.get("/me/verified-items").then((r) => setVault(r.data)).catch(() => {});
    api.get("/me/wishlist").then((r) => setWish(r.data)).catch(() => {});
    api.get("/me/consultations").then((r) => setConsultations(r.data)).catch(() => {});
    api.get("/me/consultation-credit").then((r) => setCredit(r.data)).catch(() => {});
  }, [user, loading, nav]);

  // Human-readable order status — the API returns snake_case enums like "pending_payment".
  const fmtStatus = (s) => (s || "").replace(/_/g, " ");

  // Self-cancel is only offered before the order ships, and only within 24h of
  // placing it — mirrors the server's own check in POST /orders/{id}/cancel.
  const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
  const canCancel = (o) =>
    ["pending_payment", "payment_failed", "paid"].includes(o.status) &&
    Date.now() - new Date(o.created_at).getTime() <= CANCEL_WINDOW_MS;

  const cancelOrder = async (o) => {
    if (!window.confirm("Cancel this order? If it was paid, a refund will be initiated automatically.")) return;
    setCancellingId(o.order_id);
    try {
      await api.post(`/orders/${o.order_id}/cancel`, {});
      nav(`/order-cancelled/${o.order_id}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not cancel this order"));
    } finally {
      setCancellingId(null);
    }
  };

  const downloadInvoice = async (o) => {
    const r = await openInvoice(`/orders/${o.order_id}/invoice`);
    if (r.ok) return;
    toast.error(r.blocked ? "Please allow popups to view your invoice" : (r.error || "Could not open the invoice"));
  };

  // "Pay now" for an unpaid order: re-initiates payment on the existing order, then
  // reuses the same Cashfree-open + verify flow as checkout (or the mock path).
  // Cashfree's modal gives no success/failure signal itself — /verify (which asks
  // Cashfree directly) is what actually confirms the payment, same as in Checkout.jsx.
  const payNow = async (o) => {
    setPayingId(o.order_id);
    try {
      const { data } = await api.post(`/checkout/pay/${o.order_id}`);
      if (data.already_paid) { toast.success("This order is already paid"); await loadOrders(); return; }
      if (data.mock_payment || (!data.payment_session_id && !data.razorpay)) {
        const paid = await api.post(`/checkout/mock-pay/${o.order_id}`);
        toast.success("Payment complete (test mode)");
        await loadOrders();
        nav(`/order-confirmed/${paid.data.order_id}`);
        return;
      }
      let verifyBody = { order_id: o.order_id };
      if (data.razorpay) {
        try {
          const rzp = await openRazorpayCheckout({
            keyId: data.razorpay.key_id, amount: data.razorpay.amount, currency: data.razorpay.currency,
            orderId: data.razorpay.order_id, name: user?.name, email: user?.email, contact: user?.phone,
          });
          verifyBody = {
            ...verifyBody,
            razorpay_payment_id: rzp.razorpay_payment_id,
            razorpay_signature: rzp.razorpay_signature,
          };
        } catch (err) {
          toast.error(err.message || "Could not load the payment gateway");
          return;
        }
      } else {
        try {
          await openCashfreeCheckout(data.payment_session_id);
        } catch (err) {
          toast.error(err.message || "Could not load the payment gateway");
          return;
        }
      }
      try {
        await api.post("/checkout/verify", verifyBody);
      } catch (err) {
        toast.error("Payment verification failed");
        return;
      }
      toast.success("Payment verified");
      await loadOrders();
      nav(`/order-confirmed/${o.order_id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not start payment");
    } finally {
      setPayingId(null);
    }
  };

  useEffect(() => {
    if (user && !user.phone_verified) setShowVerify(true);
  }, [user]);

  if (loading || !user) return <div className="p-16 text-ink-muted">Loading…</div>;

  const linkPhone = async (phone, token) => {
    try {
      await api.post("/auth/link-phone", { phone, otp_verification_token: token });
      toast.success("Phone linked to your account");
      setShowVerify(false);
      await refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not link phone");
    }
  };

  const doChangePhone = async (phone, token) => {
    try {
      await api.post("/auth/change-phone", { new_phone: phone, otp_verification_token: token });
      toast.success("Phone updated");
      setChangingPhone(false);
      await refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not change phone");
    }
  };

  const toggleWaOptin = async (nextVal) => {
    const prevUser = patchUser({ wa_optin: nextVal });
    try {
      await api.post("/me/wa-optin", { wa_optin: nextVal });
      toast.success(nextVal ? "You're subscribed to WhatsApp updates" : "You've unsubscribed from WhatsApp updates");
    } catch (e) {
      if (prevUser) patchUser({ wa_optin: prevUser.wa_optin });
      toast.error(e.response?.data?.detail || "Could not update preference");
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 lg:px-10 py-12">
      {/* Phone verification banner for Google users without a phone */}
      {!user.phone_verified && (
        <div className="mb-8 gold-line-strong bg-cream p-5 flex items-center gap-4" data-testid="phone-verify-banner">
          <Phone size={24} weight="duotone" className="text-maroon-deep shrink-0" />
          <div className="flex-1">
            <div className="font-serifd text-lg text-maroon-deep">One more step — verify your phone</div>
            <div className="text-xs text-ink-soft mt-1">Every Tredeva account needs a verified mobile number. It's how we confirm delivery, send tracking, and reach you if a certificate needs re-issuing.</div>
          </div>
          <button
            onClick={() => setShowVerify(true)}
            data-testid="phone-verify-open"
            className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest hover-lift"
          >
            Verify now
          </button>
        </div>
      )}

      {showVerify && !user.phone_verified && (
        <PhoneVerify
          open
          onClose={() => setShowVerify(false)}
          onVerified={linkPhone}
        />
      )}

      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Namaste</div>
          <h1 className="font-display text-4xl md:text-5xl text-ink mt-2">{user.name}</h1>
          <div className="text-ink-muted text-sm mt-1 flex items-center gap-3 flex-wrap">
            <span>{user.email}</span>
            {user.phone && (
              <span className="inline-flex items-center gap-1 text-verified">
                <ShieldCheck size={12} weight="duotone" /> <span className="font-mono">{user.phone}</span>
              </span>
            )}
          </div>
        </div>
        {user.is_admin && (
          <Link to="/admin" className="border border-maroon text-maroon px-4 py-2 text-xs uppercase tracking-widest hover:bg-maroon hover:text-ivory transition-colors">
            Admin dashboard
          </Link>
        )}
      </div>

      <nav className="mt-10 flex gap-8 border-b border-gold/30 flex-wrap">
        {[
          ["vault", "Verified Items", ShieldCheck, vault.length],
          ["orders", "Orders", Package, orders.length],
          ["wishlist", "Wishlist", Heart, wish.length],
          ["consultations", "Consultations", Calendar, consultations.length],
          ["wallet", "Wallet", Wallet, credit?.available ? 1 : 0],
          ["support", "Help & Support", ChatCircleDots, null],
          ["settings", "Settings", Gear, null],
        ].map(([k, l, Icon, count]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`account-tab-${k}`} className={`pb-3 text-sm flex items-center gap-2 ${tab === k ? "text-maroon-deep border-b-2 border-maroon" : "text-ink-muted hover:text-maroon"}`}>
            <Icon size={16} weight="duotone" /> {l} {count != null && <span className="text-[10px] text-ink-muted">({count})</span>}
          </button>
        ))}
      </nav>

      <div className="mt-10">
        {tab === "vault" && (
          <div>
            <div className="max-w-2xl">
              <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Your permanent provenance vault</div>
              <p className="mt-2 text-ink-soft">Every serialised item you own from Tredeva, with its certificate, QR and audit trail — kept forever, even if you sell or gift the item.</p>
            </div>
            {vault.length === 0 ? (
              <div className="mt-8 gold-line p-10 text-center text-ink-muted">
                Once your order is dispatched, its certificate appears here permanently.
              </div>
            ) : (
              <div className="mt-8 grid md:grid-cols-2 gap-6">
                {vault.map(({ item, cert, product }) => (
                  <div key={item.unit_id} className="gold-line bg-ivory p-6 flex gap-5">
                    {product.images?.[0] && <div className="w-28 h-28 overflow-hidden gold-line shrink-0"><img src={mediaSrc(product.images[0])} alt="" className="w-full h-full object-cover" /></div>}
                    <div className="flex-1">
                      {product.devanagari_name && <div className="font-deva text-gold-soft">{product.devanagari_name}</div>}
                      <div className="font-serifd text-xl text-ink">{product.name}</div>
                      <div className="mt-1 text-xs font-mono text-ink-muted">{cert?.serial}</div>
                      <Link to={`/verify/${cert?.qr_token}`} className="mt-3 inline-flex items-center gap-2 text-sm text-maroon">
                        <ShieldCheck size={14} weight="duotone" /> Open certificate <ArrowRight size={12} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "orders" && (
          <div className="space-y-4">
            {orders.length === 0 && <div className="gold-line p-10 text-center text-ink-muted">No orders yet.</div>}
            {orders.map((o) => {
              const isOpen = expandedOrder === o.order_id;
              return (
              <div key={o.order_id} data-testid={`order-${o.order_id}`} className="gold-line bg-ivory p-6">
                <button
                  type="button"
                  onClick={() => setExpandedOrder(isOpen ? null : o.order_id)}
                  data-testid={`order-toggle-${o.order_id}`}
                  className="w-full flex items-baseline justify-between text-left"
                >
                  <div>
                    <div className="font-mono text-xs text-ink-muted">{o.order_id}</div>
                    <div className="mt-1 text-sm">{new Date(o.created_at).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-display text-2xl text-maroon-deep">{formatPrice(o.total, o.currency)}</div>
                      <div className={`text-xs uppercase tracking-widest ${o.status === "shipped" ? "text-verified" : o.status === "paid" ? "text-gold-soft" : o.status === "payment_failed" ? "text-revoked" : "text-ink-muted"}`}>{fmtStatus(o.status)}</div>
                    </div>
                    {isOpen ? <CaretUp size={18} className="text-ink-muted shrink-0" /> : <CaretDown size={18} className="text-ink-muted shrink-0" />}
                  </div>
                </button>

                {!isOpen && (
                  <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm text-ink-soft">
                    {o.items.map((li) => (
                      <div key={li.line_id} className="flex items-center gap-3">
                        {/* Fixed-size box either way, so rows stay aligned whether or
                            not a product has artwork. */}
                        {li.image ? (
                          <img src={mediaSrc(li.image)} alt="" loading="lazy"
                            className="w-11 h-11 object-cover gold-line shrink-0" />
                        ) : (
                          <div className="w-11 h-11 bg-cream gold-line shrink-0" />
                        )}
                        <span className="flex-1 min-w-0 truncate">
                          {li.name}
                          {li.qty > 1 && <span className="text-ink-muted"> × {li.qty}</span>}
                        </span>
                        <span className="font-mono shrink-0">{formatPrice(li.price * li.qty, o.currency)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {isOpen && (
                  <div className="mt-5 pt-4 border-t border-gold/30 space-y-4" data-testid={`order-details-${o.order_id}`}>
                    <OrderTracking order={o} />

                    <div>
                      <div className="text-xs uppercase tracking-widest text-ink-muted mb-2">Items</div>
                      <div className="space-y-3">
                        {o.items.map((li) => (
                          <div key={li.line_id} className="flex items-center gap-3 text-sm">
                            {li.image && <img src={mediaSrc(li.image)} alt="" loading="lazy" className="w-14 h-14 object-cover gold-line shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className="truncate">{li.name} {li.qty > 1 ? <span className="text-ink-muted">× {li.qty}</span> : null}</div>
                              {describeOptions(li.options_list) && (
                                <div className="text-xs text-ink-muted">{describeOptions(li.options_list)}</div>
                              )}
                              {li.serials?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {li.serials.map((s) => <span key={s} className="text-[10px] font-mono bg-cream gold-line px-1 py-0.5">{s}</span>)}
                                </div>
                              )}
                              {li.pooja_details && (
                                <div className="mt-1.5 pt-1.5 border-t border-gold/20 text-[11px] text-ink-soft">
                                  <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1 flex items-center gap-1">
                                    <VideoCamera size={11} weight="duotone" /> Pooja Details
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                                    <div><span className="text-ink-muted">Name</span> {li.pooja_details.name}</div>
                                    {/* stored lowercase (male/female/other) — cased for display only */}
                                    <div><span className="text-ink-muted">Gender</span> <span className="capitalize">{li.pooja_details.gender}</span></div>
                                    <div><span className="text-ink-muted">DOB</span> {li.pooja_details.dob}</div>
                                    <div><span className="text-ink-muted">Time</span> {li.pooja_details.birth_time || "—"}</div>
                                    <div className="col-span-2"><span className="text-ink-muted">Birthplace</span> {li.pooja_details.birth_place}</div>
                                    {li.pooja_details.gotra && (
                                      <div className="col-span-2"><span className="text-ink-muted">Gotra</span> {li.pooja_details.gotra}</div>
                                    )}
                                    <div className="col-span-2"><span className="text-ink-muted">Purpose</span> {li.pooja_details.purpose_label}</div>
                                  </div>
                                </div>
                              )}
                            </div>
                            <span className="font-mono text-xs shrink-0">{formatPrice(li.price * li.qty, o.currency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="gold-line bg-cream p-4 text-sm">
                      <div className="flex justify-between"><span className="text-ink-muted">Subtotal</span><span className="font-mono">{formatPrice(o.subtotal, o.currency)}</span></div>
                      <div className="flex justify-between mt-1"><span className="text-ink-muted">GST</span><span className="font-mono">{formatPrice(o.gst, o.currency)}</span></div>
                      {o.shipping_total > 0 && (
                        <div className="flex justify-between mt-1"><span className="text-ink-muted">Shipping</span><span className="font-mono">{formatPrice(o.shipping_total, o.currency)}</span></div>
                      )}
                      <div className="flex justify-between mt-2 pt-2 border-t border-gold/30 font-display text-lg text-maroon-deep"><span>Total</span><span>{formatPrice(o.total, o.currency)}</span></div>
                    </div>

                    <div className="gold-line bg-cream p-4">
                      <div className="text-xs uppercase tracking-widest text-ink-muted flex items-center gap-1.5 mb-2">
                        <MapPin size={14} weight="duotone" /> Delivery address
                      </div>
                      <div className="text-sm">{o.shipping?.shipping_name} · {o.shipping?.shipping_phone}</div>
                      <div className="text-sm text-ink-soft mt-0.5">{o.shipping?.shipping_address}</div>
                      <div className="text-sm text-ink-soft">
                        {[o.shipping?.shipping_city, o.shipping?.shipping_state, o.shipping?.shipping_pincode].filter(Boolean).join(", ")}
                      </div>
                    </div>
                  </div>
                )}

                {o.invoice_number && (
                  <div className="mt-5 pt-4 border-t border-gold/30 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-ink-muted">
                      Tax invoice <span className="font-mono">{o.invoice_number}</span>
                    </div>
                    <button
                      onClick={() => downloadInvoice(o)}
                      data-testid={`order-invoice-${o.order_id}`}
                      className="border border-maroon text-maroon px-6 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover:bg-maroon hover:text-ivory transition-colors"
                    >
                      <CertIcon size={14} weight="duotone" /> Download invoice
                    </button>
                  </div>
                )}

                {(o.status === "pending_payment" || o.status === "payment_failed") && (
                  <div className="mt-5 pt-4 border-t border-gold/30 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-ink-muted">
                      {o.status === "payment_failed" ? "Payment failed — no amount was deducted." : "Payment for this order is incomplete."}
                    </div>
                    <AsyncButton
                      onClick={() => payNow(o)}
                      loading={payingId === o.order_id}
                      loadingText="Starting…"
                      data-testid={`order-pay-now-${o.order_id}`}
                      className="brand-gradient text-ivory px-6 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover-lift disabled:opacity-50"
                    >
                      <LockKey size={14} weight="duotone" /> Pay now
                    </AsyncButton>
                  </div>
                )}

                {canCancel(o) && (
                  <div className="mt-5 pt-4 border-t border-gold/30 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-ink-muted">
                      {o.status === "paid"
                        ? "Free cancellation within 24 hours of placing an order."
                        : "This order hasn't been paid yet — you can cancel it anytime within 24 hours."}
                    </div>
                    <AsyncButton
                      onClick={() => cancelOrder(o)}
                      loading={cancellingId === o.order_id}
                      loadingText="Cancelling…"
                      data-testid={`order-cancel-${o.order_id}`}
                      className="border border-revoked text-revoked px-6 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover:bg-revoked hover:text-ivory transition-colors disabled:opacity-50"
                    >
                      <XCircle size={14} weight="duotone" /> Cancel order
                    </AsyncButton>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}

        {tab === "wishlist" && (
          <div className="grid md:grid-cols-3 gap-5">
            {wish.length === 0 && <div className="gold-line p-10 text-center text-ink-muted col-span-full">Nothing saved yet.</div>}
            {wish.map((p) => (
              <Link key={p.product_id} to={`/product/${p.slug}`} className="gold-line bg-ivory p-4 hover-lift">
                <div className="aspect-square overflow-hidden gold-line">{p.images?.[0] && <img src={mediaSrc(p.images[0])} className="w-full h-full object-cover" alt="" />}</div>
                <div className="mt-3 font-serifd text-lg">{p.name}</div>
                <div className="text-sm text-maroon-deep">{formatINR(p.price)}</div>
              </Link>
            ))}
          </div>
        )}

        {tab === "consultations" && (
          <div>
            <Link to="/consultation" className="inline-flex items-center gap-2 brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest hover-lift">
              <Calendar size={14} weight="duotone" /> Book a consultation
            </Link>
            <div className="mt-6 space-y-3">
              {consultations.length === 0 && <div className="gold-line p-10 text-center text-ink-muted">No consultations yet.</div>}
              {consultations.map((c) => (
                <div key={c.booking_id} className="gold-line bg-ivory p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm">
                      {c.astrologer_id
                        ? new Date(c.slot_iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                        : (c.preferred_date ? new Date(c.preferred_date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : new Date(c.slot_iso).toLocaleDateString())}
                      {!c.astrologer_id && c.time_of_day && <span className="capitalize text-ink-muted"> · {c.time_of_day}</span>}
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      {c.astrologer_name ? `With ${c.astrologer_name} · 30 min` : "Astrologer to be assigned — we'll confirm on WhatsApp"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-widest text-maroon-deep">{c.status}</div>
                    {c.meeting_link && (
                      <a href={c.meeting_link} target="_blank" rel="noreferrer"
                         className="mt-2 brand-gradient text-ivory px-4 py-2 text-[11px] uppercase tracking-widest inline-flex items-center gap-2">
                        <VideoCamera size={12} weight="duotone" /> Join Consultation
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "wallet" && (
          <div className="max-w-md">
            <div className="gold-line bg-ivory p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-gold-soft">
                <Wallet size={16} weight="duotone" /> Consultation credit
              </div>
              <div className="font-display text-4xl text-maroon-deep mt-3">
                {credit?.available ? formatINR(credit.amount) : formatINR(0)}
              </div>
              {credit?.available ? (
                <div className="text-xs text-ink-muted mt-2">
                  Applied automatically at your next checkout · expires {new Date(credit.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </div>
              ) : (
                <div className="text-xs text-ink-muted mt-2">
                  No credit available yet. A paid consultation credits its fee here once the astrologer marks the session complete.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "support" && <AccountSupport user={user} orders={orders} />}

        {tab === "settings" && (
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
            {/* Phone number */}
            <div className="gold-line bg-ivory p-6">
              <div className="flex items-center gap-2 text-maroon-deep">
                <Phone size={20} weight="duotone" />
                <span className="font-serifd text-xl">Mobile number</span>
              </div>
              {user.phone ? (
                <>
                  <div className="mt-4 font-mono text-lg text-ink">{user.phone}</div>
                  <div className="mt-1 text-verified text-xs inline-flex items-center gap-1">
                    <ShieldCheck size={12} weight="duotone" /> Verified
                  </div>
                  <button
                    onClick={() => setChangingPhone(true)}
                    data-testid="account-change-phone"
                    className="mt-5 inline-flex items-center gap-2 border border-maroon text-maroon px-4 py-2 text-xs uppercase tracking-widest hover:bg-maroon hover:text-ivory transition-colors"
                  >
                    <PencilSimple size={14} weight="duotone" /> Change phone
                  </button>
                </>
              ) : (
                <>
                  <div className="mt-4 text-sm text-ink-soft">No phone on file. Verify one to receive WhatsApp order updates.</div>
                  <button onClick={() => setShowVerify(true)} className="mt-4 brand-gradient text-ivory px-4 py-2 text-xs uppercase tracking-widest hover-lift">
                    Add & verify phone
                  </button>
                </>
              )}
            </div>

            {/* WhatsApp opt-in */}
            <div className="gold-line bg-ivory p-6">
              <div className="flex items-center gap-2 text-maroon-deep">
                <WhatsappLogo size={20} weight="duotone" />
                <span className="font-serifd text-xl">WhatsApp updates</span>
              </div>
              <p className="mt-3 text-sm text-ink-soft leading-relaxed">
                Order dispatch alerts, temple pooja recordings, and new-arrival announcements — sent to your verified number on WhatsApp.
              </p>
              <label className="mt-5 flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!user.wa_optin}
                  data-testid="account-wa-optin-toggle"
                  onClick={() => toggleWaOptin(!user.wa_optin)}
                  className={`relative w-12 h-6 border ${user.wa_optin ? "bg-verified border-verified" : "bg-cream border-gold/40"}`}
                  style={{ transition: "background-color 200ms ease, border-color 200ms ease" }}
                >
                  <span
                    className={`absolute top-[2px] w-4 h-4 bg-ivory shadow-sm`}
                    style={{ left: user.wa_optin ? "26px" : "2px", transition: "left 200ms ease" }}
                  />
                </button>
                <span className="text-sm">
                  {user.wa_optin ? "Subscribed" : "Unsubscribed"}
                </span>
              </label>
              <div className="mt-3 text-[11px] text-ink-muted">
                Order & delivery notifications are always sent (transactional). Only marketing broadcasts respect this switch.
              </div>
            </div>

            {/* Email */}
            <div className="gold-line bg-ivory p-6 md:col-span-2">
              <div className="text-xs uppercase tracking-widest text-ink-muted">Email</div>
              <div className="mt-2 font-mono text-ink">{user.email}</div>
            </div>
          </div>
        )}

        {/* Change-phone modal */}
        {changingPhone && (
          <PhoneVerify
            open
            onClose={() => setChangingPhone(false)}
            onVerified={doChangePhone}
          />
        )}
      </div>

      <PaymentGatewayOverlay open={!!payingId} />
    </div>
  );
}
