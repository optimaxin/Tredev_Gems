import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Calendar, User, Phone, EnvelopeSimple, CheckCircle, WhatsappLogo } from "@phosphor-icons/react";

// Next 5 calendar days, date-only — exact time is a preference (morning/afternoon/
// evening), the real slot is agreed over WhatsApp once we assign an astrologer.
function nextDates(n = 5) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD, no time component
  }
  return out;
}

const TIME_OF_DAY = [
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

const DATES = nextDates(5);

function openRazorpay(options) {
  if (!window.Razorpay) {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => new window.Razorpay(options).open();
    s.onerror = () => toast.error("Could not load the payment gateway");
    document.body.appendChild(s);
  } else {
    new window.Razorpay(options).open();
  }
}

export default function Consultation() {
  const { user } = useAuth();
  const [fee, setFee] = useState(39900);
  const [date, setDate] = useState(DATES[0]);
  const [timeOfDay, setTimeOfDay] = useState("morning");
  const [form, setForm] = useState({ name: "", phone: "", email: "", concern: "" });
  const [paying, setPaying] = useState(false);
  const [booked, setBooked] = useState(null); // holds the booked consultation once paid

  useEffect(() => {
    api.get("/consultation/fee").then((r) => setFee(r.data.fee)).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      setForm((f) => ({ ...f, name: f.name || user.name || "", phone: f.phone || user.phone || "", email: f.email || user.email || "" }));
    }
  }, [user]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const verify = async (bookingId, payload) => {
    try {
      const { data } = await api.post(`/consultation/${bookingId}/verify`, payload);
      toast.success("Payment verified");
      setBooked(data);
    } catch (err) {
      toast.error("Payment verification failed");
    } finally {
      setPaying(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.email) { toast.error("Please fill your name, phone and email"); return; }
    setPaying(true);
    try {
      const { data } = await api.post("/consultation/request", {
        preferred_date: date, time_of_day: timeOfDay, ...form,
      });
      const bookingId = data.consultation.booking_id;

      if (!data.razorpay_key_id) {
        // Mock mode (no live Razorpay keys on the server) — complete immediately.
        const mp = await api.post(`/consultation/${bookingId}/mock-pay`);
        toast.success("Payment complete (test mode)");
        setBooked(mp.data);
        setPaying(false);
        return;
      }

      const options = {
        key: data.razorpay_key_id,
        amount: fee,
        currency: "INR",
        name: "Tredev",
        description: "Astrology consultation",
        order_id: bookingId, // informational only — verify uses the path param, not this
        prefill: { name: form.name, email: form.email, contact: form.phone },
        theme: { color: "#722F37" },
        handler: (rp) => verify(bookingId, {
          order_id: bookingId,
          razorpay_order_id: rp.razorpay_order_id,
          razorpay_payment_id: rp.razorpay_payment_id,
          razorpay_signature: rp.razorpay_signature,
        }),
        modal: { ondismiss: () => setPaying(false) },
      };
      openRazorpay(options);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not start booking");
      setPaying(false);
    }
  };

  if (booked) {
    return (
      <div className="mx-auto max-w-2xl px-6 lg:px-10 py-20 text-center">
        <div className="mx-auto w-20 h-20 rounded-full brand-gradient flex items-center justify-center">
          <CheckCircle size={40} weight="fill" className="text-ivory" />
        </div>
        <h1 className="font-display text-4xl text-ink mt-6">Consultation booked</h1>
        <p className="mt-4 text-ink-soft leading-relaxed">
          We'll send you a confirmation message on WhatsApp shortly with your astrologer and meeting link.
        </p>
        <div className="mt-8 gold-line bg-ivory p-6 text-left">
          <div className="flex justify-between text-sm"><span className="text-ink-muted">Date</span><span>{new Date(booked.preferred_date || date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span></div>
          <div className="flex justify-between text-sm mt-2"><span className="text-ink-muted">Preferred time</span><span className="capitalize">{booked.time_of_day || timeOfDay}</span></div>
          <div className="flex justify-between text-sm mt-2 pt-2 border-t border-gold/30"><span className="text-ink-muted">Amount paid</span><span className="font-display text-lg text-maroon-deep">{formatINR(fee)}</span></div>
        </div>
        <div className="mt-6 text-xs text-ink-muted inline-flex items-center gap-2">
          <WhatsappLogo size={14} weight="duotone" className="text-verified" />
          If you purchase anything after this, {formatINR(fee)} is credited toward that order (within 90 days).
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 lg:px-10 py-14 grid lg:grid-cols-2 gap-10 items-start">
      <div>
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Guidance · परामर्श</div>
        <h1 className="font-display text-4xl md:text-5xl text-ink mt-3">Book a consultation</h1>
        <p className="mt-4 text-ink-soft leading-relaxed">
          Speak with a verified astrologer. Not a chatbot — a human, on a scheduled call. We'll match you
          with the right astrologer and confirm the exact time on WhatsApp.
        </p>
        <div className="mt-6 gold-line overflow-hidden bg-maroon-deep">
          <img src="/ambassador/ambassador-consultation.png" alt="Consultation blessing" className="w-full h-80 object-cover object-top" />
        </div>
        <div className="mt-6 font-display text-3xl text-maroon-deep">{formatINR(fee)}</div>
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
                className={`text-xs p-3 border ${date === d ? "border-maroon bg-cream" : "border-gold/40 hover:border-maroon"}`}>
                {new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-widest text-ink-muted mb-3">Preferred time</div>
          <div className="grid grid-cols-3 gap-2">
            {TIME_OF_DAY.map((t) => (
              <button type="button" key={t.key} onClick={() => setTimeOfDay(t.key)}
                className={`text-xs p-3 border ${timeOfDay === t.key ? "border-maroon bg-cream" : "border-gold/40 hover:border-maroon"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <div className="text-xs text-ink-muted mb-1 flex items-center gap-2"><User size={12} /> Name</div>
          <input required value={form.name} onChange={set("name")} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
        </label>
        <label className="block">
          <div className="text-xs text-ink-muted mb-1 flex items-center gap-2"><Phone size={12} /> Phone</div>
          <input required value={form.phone} onChange={set("phone")} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
        </label>
        <label className="block">
          <div className="text-xs text-ink-muted mb-1 flex items-center gap-2"><EnvelopeSimple size={12} /> Email</div>
          <input required type="email" value={form.email} onChange={set("email")} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
        </label>
        <label className="block">
          <div className="text-xs text-ink-muted mb-1">Concern</div>
          <textarea value={form.concern} onChange={set("concern")} rows={3} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
        </label>

        <button disabled={paying} className="w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest hover-lift disabled:opacity-50">
          {paying ? "Processing…" : `Pay ${formatINR(fee)} & book`}
        </button>
      </form>
    </div>
  );
}
