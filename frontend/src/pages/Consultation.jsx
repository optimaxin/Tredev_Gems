import React, { useEffect, useState } from "react";
import { api, formatINR } from "@/lib/api";
import { toast } from "sonner";
import { Calendar, User, Phone, EnvelopeSimple } from "@phosphor-icons/react";

function nextSlots(n = 6) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + Math.ceil(i / 2));
    d.setHours(10 + (i % 4) * 2, 0, 0, 0);
    out.push(d.toISOString());
  }
  return out;
}

export default function Consultation() {
  const [astros, setAstros] = useState([]);
  const [sel, setSel] = useState(null);
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", concern: "" });
  const slots = nextSlots(6);

  useEffect(() => {
    api.get("/consultation/astrologers").then((r) => setAstros(r.data));
  }, []);

  const book = async (e) => {
    e.preventDefault();
    if (!sel || !slot) { toast.error("Pick an astrologer and a slot"); return; }
    try {
      await api.post("/consultation/book", { astrologer_id: sel.astrologer_id, slot_iso: slot, ...form });
      toast.success("Consultation requested — we'll confirm on WhatsApp shortly");
      setForm({ name: "", phone: "", email: "", concern: "" });
      setSlot(null);
    } catch (e) { toast.error(e.response?.data?.detail || "Booking failed"); }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 lg:px-10 py-14">
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Guidance · परामर्श</div>
      <h1 className="font-display text-4xl md:text-5xl text-ink mt-3">Book a consultation</h1>
      <p className="mt-4 max-w-2xl text-ink-soft">Speak with a verified astrologer. Not a chatbot — a human, on a scheduled call.</p>

      <div className="mt-10 grid md:grid-cols-3 gap-5">
        {astros.map((a) => (
          <button
            key={a.astrologer_id}
            onClick={() => setSel(a)}
            className={`text-left gold-line bg-ivory p-5 hover-lift ${sel?.astrologer_id === a.astrologer_id ? "border-maroon" : ""}`}
          >
            <div className="aspect-[4/3] overflow-hidden gold-line mb-4">
              <img src={a.picture} alt={a.name} className="w-full h-full object-cover" />
            </div>
            <div className="font-deva text-gold-soft">{a.devanagari}</div>
            <div className="font-serifd text-xl text-ink">{a.name}</div>
            <div className="text-xs text-ink-muted mt-1">{a.years} years · {a.expertise.join(", ")}</div>
            <div className="mt-2 text-maroon-deep font-display text-lg">{formatINR(a.price)} / session</div>
          </button>
        ))}
      </div>

      {sel && (
        <form onSubmit={book} className="mt-12 gold-line bg-ivory p-8 grid md:grid-cols-2 gap-8">
          <div>
            <div className="text-xs uppercase tracking-widest text-ink-muted mb-3 flex items-center gap-2"><Calendar size={14} weight="duotone" /> Choose a slot</div>
            <div className="grid grid-cols-2 gap-2">
              {slots.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setSlot(s)}
                  className={`text-xs p-3 border ${slot === s ? "border-maroon bg-cream" : "border-gold/40 hover:border-maroon"}`}
                >
                  {new Date(s).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <label className="block">
              <div className="text-xs text-ink-muted mb-1 flex items-center gap-2"><User size={12} /> Name</div>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
            </label>
            <label className="block">
              <div className="text-xs text-ink-muted mb-1 flex items-center gap-2"><Phone size={12} /> Phone</div>
              <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
            </label>
            <label className="block">
              <div className="text-xs text-ink-muted mb-1 flex items-center gap-2"><EnvelopeSimple size={12} /> Email</div>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
            </label>
            <label className="block">
              <div className="text-xs text-ink-muted mb-1">Concern</div>
              <textarea value={form.concern} onChange={(e) => setForm({ ...form, concern: e.target.value })} rows={3} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon" />
            </label>
            <button className="w-full brand-gradient text-ivory py-3 text-sm uppercase tracking-widest hover-lift">Request booking</button>
          </div>
        </form>
      )}
    </div>
  );
}
