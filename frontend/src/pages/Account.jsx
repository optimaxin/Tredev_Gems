import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatINR } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ShieldCheck, Package, Heart, Certificate as CertIcon, ArrowRight, Phone, WhatsappLogo, Gear, PencilSimple, LockKey, ChatCircleDots } from "@phosphor-icons/react";
import PhoneVerify from "@/components/gemora/PhoneVerify";
import AccountSupport from "@/components/gemora/AccountSupport";
import { toast } from "sonner";

export default function Account() {
  const { user, loading, refresh } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState("vault");
  const [orders, setOrders] = useState([]);
  const [vault, setVault] = useState([]);
  const [wish, setWish] = useState([]);
  const [showVerify, setShowVerify] = useState(false);
  const [changingPhone, setChangingPhone] = useState(false);
  const [payingId, setPayingId] = useState(null);

  const loadOrders = () => api.get("/orders").then((r) => setOrders(r.data)).catch(() => {});

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/login"); return; }
    loadOrders();
    api.get("/me/verified-items").then((r) => setVault(r.data)).catch(() => {});
    api.get("/me/wishlist").then((r) => setWish(r.data)).catch(() => {});
  }, [user, loading, nav]);

  // Human-readable order status — the API returns snake_case enums like "pending_payment".
  const fmtStatus = (s) => (s || "").replace(/_/g, " ");

  const openRazorpay = (options) => {
    if (!window.Razorpay) {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => new window.Razorpay(options).open();
      document.body.appendChild(s);
    } else {
      new window.Razorpay(options).open();
    }
  };

  // "Pay now" for an unpaid order: re-initiates payment on the existing order, then
  // reuses the same Razorpay-open + verify flow as checkout (or the mock path).
  const payNow = async (o) => {
    setPayingId(o.order_id);
    try {
      const { data } = await api.post(`/checkout/pay/${o.order_id}`);
      if (data.already_paid) { toast.success("This order is already paid"); await loadOrders(); return; }
      if (data.mock_payment || !data.razorpay_key_id) {
        const paid = await api.post(`/checkout/mock-pay/${o.order_id}`);
        toast.success("Payment complete (test mode)");
        await loadOrders();
        nav(`/order-confirmed/${paid.data.order_id}`);
        return;
      }
      const options = {
        key: data.razorpay_key_id,
        amount: o.total,
        currency: "INR",
        name: "Tredev",
        description: "Complete your pending payment",
        order_id: data.razorpay_order_id,
        prefill: { name: user.name, email: user.email, contact: user.phone || "" },
        theme: { color: "#722F37" },
        handler: async (rp) => {
          try {
            await api.post("/checkout/verify", {
              order_id: o.order_id,
              razorpay_order_id: rp.razorpay_order_id,
              razorpay_payment_id: rp.razorpay_payment_id,
              razorpay_signature: rp.razorpay_signature,
            });
          } catch (err) {
            toast.error("Payment verification failed");
            return;
          }
          toast.success("Payment verified");
          await loadOrders();
          nav(`/order-confirmed/${o.order_id}`);
        },
      };
      openRazorpay(options);
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
    try {
      await api.post("/me/wa-optin", { wa_optin: nextVal });
      toast.success(nextVal ? "You're subscribed to WhatsApp updates" : "You've unsubscribed from WhatsApp updates");
      await refresh();
    } catch (e) {
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
            <div className="text-xs text-ink-soft mt-1">Every Tredev account needs a verified mobile number. It's how we confirm delivery, send tracking, and reach you if a certificate needs re-issuing.</div>
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
              <p className="mt-2 text-ink-soft">Every serialised item you own from Tredev, with its certificate, QR and audit trail — kept forever, even if you sell or gift the item.</p>
            </div>
            {vault.length === 0 ? (
              <div className="mt-8 gold-line p-10 text-center text-ink-muted">
                Once your order is dispatched, its certificate appears here permanently.
              </div>
            ) : (
              <div className="mt-8 grid md:grid-cols-2 gap-6">
                {vault.map(({ item, cert, product }) => (
                  <div key={item.unit_id} className="gold-line bg-ivory p-6 flex gap-5">
                    {product.images?.[0] && <div className="w-28 h-28 overflow-hidden gold-line shrink-0"><img src={product.images[0]} alt="" className="w-full h-full object-cover" /></div>}
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
            {orders.map((o) => (
              <div key={o.order_id} data-testid={`order-${o.order_id}`} className="gold-line bg-ivory p-6">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="font-mono text-xs text-ink-muted">{o.order_id}</div>
                    <div className="mt-1 text-sm">{new Date(o.created_at).toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-2xl text-maroon-deep">{formatINR(o.total)}</div>
                    <div className={`text-xs uppercase tracking-widest ${o.status === "shipped" ? "text-verified" : o.status === "paid" ? "text-gold-soft" : "text-ink-muted"}`}>{fmtStatus(o.status)}</div>
                  </div>
                </div>
                <div className="mt-4 grid md:grid-cols-2 gap-2 text-sm text-ink-soft">
                  {o.items.map((li) => (
                    <div key={li.line_id} className="flex justify-between">
                      <span>{li.name}</span>
                      <span className="font-mono">{formatINR(li.price * li.qty)}</span>
                    </div>
                  ))}
                </div>
                {o.status === "pending_payment" && (
                  <div className="mt-5 pt-4 border-t border-gold/30 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-ink-muted">Payment for this order is incomplete.</div>
                    <button
                      onClick={() => payNow(o)}
                      disabled={payingId === o.order_id}
                      data-testid={`order-pay-now-${o.order_id}`}
                      className="brand-gradient text-ivory px-6 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover-lift disabled:opacity-50"
                    >
                      <LockKey size={14} weight="duotone" /> {payingId === o.order_id ? "Starting…" : "Pay now"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "wishlist" && (
          <div className="grid md:grid-cols-3 gap-5">
            {wish.length === 0 && <div className="gold-line p-10 text-center text-ink-muted col-span-full">Nothing saved yet.</div>}
            {wish.map((p) => (
              <Link key={p.product_id} to={`/product/${p.slug}`} className="gold-line bg-ivory p-4 hover-lift">
                <div className="aspect-square overflow-hidden gold-line">{p.images?.[0] && <img src={p.images[0]} className="w-full h-full object-cover" alt="" />}</div>
                <div className="mt-3 font-serifd text-lg">{p.name}</div>
                <div className="text-sm text-maroon-deep">{formatINR(p.price)}</div>
              </Link>
            ))}
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
    </div>
  );
}
