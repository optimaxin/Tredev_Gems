import React, { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import {
  Calendar, User, Phone, EnvelopeSimple, CheckCircle, WhatsappLogo, ShieldCheck,
  ArrowsClockwise, SunHorizon, Sun, MoonStars, Sparkle, PaperPlaneTilt,
} from "@phosphor-icons/react";
import PaymentFailedModal from "@/components/gemora/PaymentFailedModal";
import { openCashfreeCheckout } from "@/lib/cashfree";

// Next 5 calendar days STARTING TOMORROW (never today/past) — exact time is a
// preference (morning/afternoon/evening), the real slot is agreed over WhatsApp
// once we assign an astrologer.
function nextDates(n = 5) {
  const out = [];
  const now = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD, no time component
  }
  return out;
}

const TIME_OF_DAY = [
  { key: "morning", label: "Morning", Icon: SunHorizon },
  { key: "afternoon", label: "Afternoon", Icon: Sun },
  { key: "evening", label: "Evening", Icon: MoonStars },
];

const TRUST = [
  { Icon: ShieldCheck, label: "Verified astrologers" },
  { Icon: WhatsappLogo, label: "Confirmed on WhatsApp" },
  { Icon: ArrowsClockwise, label: "Fee credited on purchase" },
];

const STEPS = [
  { title: "Pick a date & time", body: "Choose a preferred day and time of day — no need to hunt through a calendar of slots." },
  { title: "We assign & confirm", body: "We match you with the right astrologer and send the meeting link on WhatsApp." },
  { title: "Join your call", body: "Speak with a real, verified astrologer at the scheduled time — not a chatbot." },
];

const DATES = nextDates(5);

const fieldBase = "w-full gold-line bg-ivory px-4 py-3 outline-none transition-colors focus:border-maroon focus-visible:ring-2 focus-visible:ring-gold/50";
const pickerBase = "text-xs p-3 border transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gold/50 flex items-center justify-center gap-1.5";
const pickerOn = "border-maroon brand-gradient text-ivory";
const pickerOff = "border-gold/40 text-ink-soft hover:border-maroon hover:bg-cream";

export default function Consultation() {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  // What booking actually charges, in the visitor's currency — /consultation/fee
  // and /consultation/request both resolve the same way (region_pricing), so this
  // is never just a display estimate the way it briefly was.
  const [fee, setFee] = useState(39900);
  const [currency, setCurrency] = useState("INR");
  const [date, setDate] = useState(DATES[0]);
  const [timeOfDay, setTimeOfDay] = useState("morning");
  const [form, setForm] = useState({ name: "", phone: "", email: "", concern: "" });
  const [paying, setPaying] = useState(false);
  const [booked, setBooked] = useState(null); // holds the booked consultation once paid
  const [failed, setFailed] = useState({ open: false, reason: null });

  useEffect(() => {
    api.get("/consultation/fee").then((r) => {
      setFee(r.data.fee); setCurrency(r.data.currency || "INR");
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      setForm((f) => ({ ...f, name: f.name || user.name || "", phone: f.phone || user.phone || "", email: f.email || user.email || "" }));
    }
  }, [user]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const verify = async (bookingId) => {
    try {
      const { data } = await api.post(`/consultation/${bookingId}/verify`);
      toast.success("Payment verified");
      setBooked(data);
    } catch (err) {
      setFailed({ open: true, reason: "We couldn't confirm this payment. If any amount was deducted, it will be refunded within 5-7 business days." });
    } finally {
      setPaying(false);
    }
  };

  const bookAndPay = async () => {
    if (!form.name || !form.phone || !form.email) { toast.error("Please fill your name, phone and email"); return; }
    setPaying(true);
    try {
      const { data } = await api.post("/consultation/request", {
        preferred_date: date, time_of_day: timeOfDay, ...form,
      });
      const bookingId = data.consultation.booking_id;

      if (!data.payment_session_id) {
        // Mock mode (no live Cashfree keys on the server) — complete immediately.
        const mp = await api.post(`/consultation/${bookingId}/mock-pay`);
        toast.success("Payment complete (test mode)");
        setBooked(mp.data);
        setPaying(false);
        return;
      }

      // Cashfree's modal gives no success/failure signal itself — /verify (which
      // asks Cashfree directly) is what actually confirms the payment, same as
      // in Checkout.jsx.
      try {
        await openCashfreeCheckout(data.payment_session_id);
      } catch (err) {
        toast.error(err.message || "Could not load the payment gateway");
        setPaying(false);
        return;
      }
      await verify(bookingId);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not start booking");
      setPaying(false);
    }
  };

  const submit = (e) => { e.preventDefault(); bookAndPay(); };

  if (booked) {
    return (
      <section className="relative overflow-hidden bg-ivory geom-bg min-h-[80vh] flex items-center">
        <div
          className="absolute left-1/2 top-24 -translate-x-1/2 w-[420px] h-[420px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(212,175,55,0.22) 0%, rgba(242,140,40,0.08) 40%, transparent 70%)" }}
        />
        <div className="relative mx-auto max-w-xl px-6 lg:px-10 py-20 text-center w-full">
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="mx-auto w-24 h-24 rounded-full brand-gradient flex items-center justify-center shadow-[0_12px_40px_-10px_rgba(114,47,55,0.55)]"
          >
            <CheckCircle size={48} weight="fill" className="text-ivory" />
          </motion.div>

          <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>
            <div className="mt-6 font-deva text-2xl text-gold-soft">शुभम् भवतु</div>
            <h1 className="mt-2 font-display text-4xl md:text-5xl text-ink">
              <span className="shimmer-text">Consultation booked</span>
            </h1>
            <p className="mt-4 text-ink-soft leading-relaxed">
              We'll send you your astrologer and joining time on WhatsApp shortly, and the meeting link over email.
            </p>
          </motion.div>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-8 gold-line bg-ivory p-6 text-left"
          >
            <div className="flex justify-between text-sm"><span className="text-ink-muted">Date</span><span>{new Date(booked.preferred_date || date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span></div>
            <div className="flex justify-between text-sm mt-2"><span className="text-ink-muted">Preferred time</span><span className="capitalize">{booked.time_of_day || timeOfDay}</span></div>
            <div className="flex justify-between text-sm mt-2 pt-2 border-t border-gold/30"><span className="text-ink-muted">Amount paid</span><span className="font-display text-lg text-maroon-deep">{formatPrice(booked.amount ?? fee, booked.currency || currency)}</span></div>
          </motion.div>

          <div className="mt-6 text-xs text-ink-muted inline-flex items-center gap-2">
            <ArrowsClockwise size={14} weight="duotone" className="text-verified" />
            If you purchase anything after this, {formatPrice(booked.amount ?? fee, booked.currency || currency)} is credited toward that order (within 90 days).
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="bg-ivory">
      <div className="mx-auto max-w-5xl px-6 lg:px-10 py-14 grid lg:grid-cols-2 gap-10 items-start">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Guidance · परामर्श</div>
          <h1 className="font-display text-4xl md:text-5xl text-ink mt-3 leading-tight">Book a consultation</h1>
          <p className="mt-4 text-ink-soft leading-relaxed">
            Speak with a verified astrologer. Not a chatbot — a human, on a scheduled call. We'll match you
            with the right astrologer and confirm the exact time on WhatsApp.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {TRUST.map(({ Icon, label }) => (
              <div key={label} className="inline-flex items-center gap-1.5 gold-line px-3 py-1.5 text-[11px] uppercase tracking-widest text-ink-soft">
                <Icon size={13} weight="duotone" className="text-gold-soft" /> {label}
              </div>
            ))}
          </div>

          <div className="mt-6 relative gold-line-strong overflow-hidden bg-maroon-deep">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: "radial-gradient(120% 90% at 72% 30%, #0B0605 0%, #2A1216 45%, #4E1F26 100%)" }}
            />
            <div
              className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[70%] aspect-square rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(242,140,40,0.35) 0%, rgba(212,175,55,0.15) 40%, transparent 70%)" }}
            />
            <img
              src="/ambassador/founder.v1.webp"
              alt="Shri Raghavendra, Tredev's founder & guide"
              loading="eager"
              className="relative w-full h-80 object-contain object-bottom"
              style={{ filter: "drop-shadow(0 12px 30px rgba(0,0,0,0.5))" }}
            />
          </div>

          <div className="mt-6 flex items-baseline gap-2">
            <span className="font-display text-3xl text-maroon-deep">{formatPrice(fee, currency)}</span>
            <span className="text-xs text-ink-muted">/ session</span>
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            Credited toward your next purchase if you buy within 90 days.
          </div>
        </div>

        <form onSubmit={submit} className="gold-line bg-ivory p-8 space-y-5">
          <div>
            <div className="text-xs uppercase tracking-widest text-ink-muted mb-3 flex items-center gap-2"><Calendar size={14} weight="duotone" /> Preferred date</div>
            <div className="grid grid-cols-3 gap-2">
              {DATES.map((d) => (
                <button type="button" key={d} onClick={() => setDate(d)}
                  className={`${pickerBase} ${date === d ? pickerOn : pickerOff}`}>
                  {new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-ink-muted mb-3">Preferred time</div>
            <div className="grid grid-cols-3 gap-2">
              {TIME_OF_DAY.map(({ key, label, Icon }) => (
                <button type="button" key={key} onClick={() => setTimeOfDay(key)}
                  className={`${pickerBase} ${timeOfDay === key ? pickerOn : pickerOff}`}>
                  <Icon size={14} weight="duotone" /> {label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <div className="text-xs text-ink-muted mb-1 flex items-center gap-2"><User size={12} /> Name <span className="text-maroon">*</span></div>
            <input required autoComplete="name" value={form.name} onChange={set("name")} className={fieldBase} />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1 flex items-center gap-2"><Phone size={12} /> Phone <span className="text-maroon">*</span></div>
            <input required type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} className={fieldBase} />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1 flex items-center gap-2"><EnvelopeSimple size={12} /> Email <span className="text-maroon">*</span></div>
            <input required type="email" autoComplete="email" value={form.email} onChange={set("email")} className={fieldBase} />
          </label>
          <label className="block">
            <div className="text-xs text-ink-muted mb-1">Concern</div>
            <textarea value={form.concern} onChange={set("concern")} rows={3} className={`${fieldBase} resize-none`} />
          </label>

          <button
            disabled={paying}
            className="w-full brand-gradient text-ivory py-3.5 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift transition-opacity disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-gold/50"
          >
            {paying ? "Processing…" : (<><PaperPlaneTilt size={15} weight="duotone" /> Pay {formatPrice(fee, currency)} & book</>)}
          </button>
        </form>
      </div>

      <div className="mx-auto max-w-5xl px-6 lg:px-10 pb-16">
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft text-center">How it works</div>
        <div className="mt-6 grid md:grid-cols-3 gap-4">
          {STEPS.map(({ title, body }, i) => (
            <div key={title} className="gold-line bg-ivory p-5 relative hover-lift">
              <div className="absolute -top-3 left-5 brand-gradient text-ivory text-[10px] tracking-widest px-2 py-0.5 uppercase font-mono">
                Step {i + 1}
              </div>
              <Sparkle size={22} weight="duotone" className="text-gold-soft mt-2" />
              <div className="font-serifd text-lg text-maroon-deep mt-2">{title}</div>
              <p className="text-sm text-ink-soft mt-1 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>

      <PaymentFailedModal
        open={failed.open}
        reason={failed.reason}
        onClose={() => setFailed({ open: false, reason: null })}
        onRetry={() => { setFailed({ open: false, reason: null }); bookAndPay(); }}
      />
    </div>
  );
}
