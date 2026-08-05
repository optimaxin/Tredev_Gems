import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { api, apiErrorMessage, mediaSrc } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { toast } from "sonner";
import {
  Sparkle, MoonStars, ShieldCheck, ArrowRight, ArrowCounterClockwise, Star, ShoppingBagOpen, Compass,
} from "@phosphor-icons/react";
import AsyncButton from "@/components/gemora/AsyncButton";
import PlaceAutocomplete from "@/components/gemora/PlaceAutocomplete";
import { Reveal, YantraWatermark } from "@/components/gemora/Editorial";

// Static positions for the featured card's rising embers — plain data, no need
// for randomization since the card layout itself is fixed.
const EMBERS = [
  { left: "12%", delay: "0s", dur: "6s", size: 3 },
  { left: "34%", delay: "1.4s", dur: "7s", size: 2.5 },
  { left: "58%", delay: "0.6s", dur: "6.5s", size: 3 },
  { left: "80%", delay: "2s", dur: "7.5s", size: 2.5 },
];

// birth_lat/birth_lon are filled only when the buyer picks a suggested place. The
// reading is computed from the chart, and a chart needs real coordinates — a typed
// city name alone can't be resolved to a rising sign.
const EMPTY = { name: "", dob: "", tob: "", place_of_birth: "", birth_lat: null, birth_lon: null, phone: "", email: "" };

const fieldBase = "w-full gold-line bg-ivory px-4 py-3 outline-none transition-colors focus:border-maroon focus-visible:ring-2 focus-visible:ring-gold/50";

// "7 Mukhi" -> "7"; non-numeric beads (Gauri Shankar) fall back to a sparkle glyph.
const mukhiNumber = (mukhi) => String(mukhi || "").match(/\d+/)?.[0];

function MukhiMedallion({ mukhi, size = "lg", featured = false }) {
  const n = mukhiNumber(mukhi);
  const dim = size === "lg" ? "w-24 h-24 text-4xl" : "w-14 h-14 text-xl";
  return (
    <div className="relative shrink-0">
      {featured && (
        <div
          className="halo-breathe absolute -inset-3 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(212,175,55,0.4) 0%, rgba(242,140,40,0.12) 45%, transparent 70%)" }}
        />
      )}
      <div className={`${dim} rounded-full brand-gradient text-ivory flex items-center justify-center font-display relative shadow-lg`}>
        {n || <Sparkle size={size === "lg" ? 32 : 18} weight="duotone" />}
      </div>
    </div>
  );
}

// A recommended bead + (if we stock that Mukhi) the real product photo/price/link.
// When we don't stock a matching piece, `p` is null — never link to a product
// that isn't actually listed; fall back to the in-stock rudraksha shelf instead.
function BeadCard({ eyebrow, rec, featured }) {
  const reduce = useReducedMotion();
  if (!rec) return null;
  const p = rec.product;
  return (
    <div className={`gold-line-strong bg-ivory ${featured ? "p-6 md:p-8" : "p-5"} relative overflow-hidden`}>
      {featured && <div className="brand-gradient h-1 absolute top-0 inset-x-0" />}
      {featured && !reduce && EMBERS.map((e, i) => (
        <span
          key={i}
          className="ember absolute rounded-full bg-gold pointer-events-none"
          style={{ left: e.left, bottom: "2%", width: e.size, height: e.size, animationDelay: e.delay, animationDuration: e.dur, boxShadow: "0 0 6px rgba(212,175,55,0.8)" }}
        />
      ))}
      <div className="text-[10px] uppercase tracking-[0.3em] text-gold-soft mb-4 relative">{eyebrow}</div>
      <div className="flex gap-5 items-start relative">
        <MukhiMedallion mukhi={rec.mukhi} size={featured ? "lg" : "sm"} featured={featured} />
        <div className="flex-1 min-w-0">
          <div className={`font-display text-ink ${featured ? "text-3xl shimmer-text" : "text-xl"}`}>{rec.mukhi}</div>
          {rec.ruling_planet && (
            <div className="text-xs text-maroon mt-1 uppercase tracking-widest">Ruled by {rec.ruling_planet}{rec.deity ? ` · ${rec.deity}` : ""}</div>
          )}
          <p className={`text-ink-soft mt-2 leading-relaxed ${featured ? "text-sm" : "text-xs"}`}>{rec.benefits || rec.note}</p>
        </div>
      </div>

      {p ? (
        <Link
          to={`/product/${p.slug}`}
          className="mt-5 flex items-center gap-4 gold-line bg-cream p-3 hover-lift group relative"
          data-testid="rudraksha-result-product"
        >
          <div className="w-16 h-16 shrink-0 overflow-hidden gold-line bg-ivory">
            <img src={mediaSrc(p.images?.[0])} alt={p.name} className="w-full h-full object-cover img-hover" loading="lazy" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-serifd text-ink text-sm truncate">{p.name}</div>
            <div className="text-maroon-deep font-display text-lg">{formatPrice(p.price, p.currency)}</div>
          </div>
          <div className="text-maroon inline-flex items-center gap-1 text-xs uppercase tracking-widest shrink-0">
            <ShoppingBagOpen size={14} weight="duotone" /> Shop <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>
      ) : (
        <Link
          to="/shop?category=rudraksha"
          className="mt-5 flex items-center gap-3 gold-line bg-cream p-3 hover-lift group relative text-xs text-maroon"
          data-testid="rudraksha-result-fallback"
        >
          <ShoppingBagOpen size={16} weight="duotone" className="shrink-0" />
          <span className="flex-1">This exact piece isn't in stock right now — browse the Rudraksha shelf instead.</span>
          <ArrowRight size={12} className="shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      )}
    </div>
  );
}

export default function LuckyRudraksha() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.birth_lat == null || form.birth_lon == null) {
      toast.error("Please pick your birth place from the suggestions list");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/calculators/lucky-rudraksha", form);
      setResult(data);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not calculate your Rudraksha right now"));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setResult(null); setForm(EMPTY); };

  return (
    <div className="bg-ivory">
      <section className="relative overflow-hidden bg-cream border-b border-gold/30 py-16">
        <div className="grain absolute inset-0 pointer-events-none" />
        <YantraWatermark className="pointer-events-none absolute -right-24 -top-24 w-[380px] h-[380px] text-gold/[0.08] hidden md:block" />
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-maroon border border-gold/50 px-3 py-1.5 bg-ivory">
            <Sparkle size={14} weight="duotone" /> Free tool · रुद्राक्ष
          </div>
          <h1 className="font-display text-4xl md:text-5xl text-ink mt-6">Find Your Lucky Rudraksha</h1>
          <p className="mt-4 text-ink-soft leading-relaxed">
            Enter your birth details — we read your Moon sign (Rashi) and Nakshatra from your chart,
            then recommend the Mukhi Rudraksha that aligns with your energy.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-6 py-14">
        {!result && (
          <Reveal>
            <form onSubmit={submit} className="gold-line-strong bg-ivory p-6 md:p-8 grid sm:grid-cols-2 gap-5">
              <label className="block sm:col-span-2">
                <div className="text-xs text-ink-muted mb-1">Full name</div>
                <input required autoComplete="name" value={form.name} onChange={set("name")} className={fieldBase} data-testid="rudraksha-name-input" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Date of birth</div>
                <input required type="date" value={form.dob} onChange={set("dob")} className={fieldBase} data-testid="rudraksha-dob-input" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Time of birth</div>
                <input required type="time" value={form.tob} onChange={set("tob")} className={fieldBase} data-testid="rudraksha-tob-input" />
              </label>
              <label className="block sm:col-span-2">
                <div className="text-xs text-ink-muted mb-1">Place of birth</div>
                <PlaceAutocomplete
                  value={form.place_of_birth}
                  onChange={(label, coords) => setForm((f) => ({
                    ...f, place_of_birth: label,
                    birth_lat: coords?.lat ?? null, birth_lon: coords?.lon ?? null,
                  }))}
                  placeholder="e.g. New Delhi, India"
                  className={fieldBase}
                  testId="rudraksha-place-input"
                  inputProps={{ required: true }}
                />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Phone</div>
                <input required type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} className={fieldBase} data-testid="rudraksha-phone-input" />
              </label>
              <label className="block">
                <div className="text-xs text-ink-muted mb-1">Email</div>
                <input required type="email" autoComplete="email" value={form.email} onChange={set("email")} className={fieldBase} data-testid="rudraksha-email-input" />
              </label>
              <div className="sm:col-span-2 mt-2">
                <AsyncButton type="submit" loading={loading} loadingText="Reading your chart…" data-testid="rudraksha-submit" className="w-full brand-gradient text-ivory px-6 py-4 text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift">
                  <MoonStars size={16} weight="duotone" /> Reveal my Rudraksha
                </AsyncButton>
                <p className="text-[10px] text-ink-muted mt-3 text-center">
                  For spiritual and informational purposes; not a substitute for professional advice.
                </p>
              </div>
            </form>
          </Reveal>
        )}

        {result && (
          <Reveal>
            <div data-testid="rudraksha-result" className="relative">
              <YantraWatermark className="pointer-events-none absolute -left-28 top-0 w-[340px] h-[340px] text-gold/[0.06] hidden lg:block -z-10" />

              {/* Chart basis strip */}
              <div className="grid grid-cols-3 gap-3 text-center mb-8">
                {[
                  [MoonStars, "Moon Sign", `${result.chart_basis?.moon_sign || "—"}`, result.chart_basis?.moon_sign_sanskrit],
                  [Star, "Nakshatra", result.chart_basis?.nakshatra || "—", result.chart_basis?.nakshatra_pada ? `Pada ${result.chart_basis.nakshatra_pada}` : ""],
                  [Compass, "Ruling Planet", result.chart_basis?.ruling_planet || "—", ""],
                ].map(([Icon, label, value, sub], i) => (
                  <Reveal key={label} delay={i * 0.08}>
                    <div className="gold-line bg-cream p-4 hover-lift">
                      <Icon size={16} weight="duotone" className="text-gold-soft mx-auto mb-1.5" />
                      <div className="text-[10px] uppercase tracking-widest text-gold-soft">{label}</div>
                      <div className="font-serifd text-lg text-maroon-deep mt-1">{value}</div>
                      {sub && <div className="text-[10px] text-ink-muted mt-0.5">{sub}</div>}
                    </div>
                  </Reveal>
                ))}
              </div>

              {/* Primary recommendation — the headline result */}
              <BeadCard eyebrow="Your primary recommendation" rec={result.recommendation?.primary} featured />

              {/* Alternative + universal safe, side by side */}
              {(result.recommendation?.alternative || result.recommendation?.universal_safe) && (
                <div className="grid sm:grid-cols-2 gap-4 mt-4">
                  {result.recommendation?.alternative && (
                    <BeadCard eyebrow="Alternative bead" rec={result.recommendation.alternative} />
                  )}
                  {result.recommendation?.universal_safe && (
                    <BeadCard eyebrow="Universal safe bead" rec={result.recommendation.universal_safe} />
                  )}
                </div>
              )}

              {/* Interpretation */}
              {result.interpretation && (
                <div className="mt-8 gold-line bg-cream p-6 flex gap-3 items-start">
                  <Star size={18} weight="duotone" className="text-gold-soft shrink-0 mt-0.5" />
                  <p className="text-sm text-ink-soft leading-relaxed italic">{result.interpretation}</p>
                </div>
              )}

              {result.disclaimer && (
                <p className="text-[10px] text-ink-muted mt-4 text-center">{result.disclaimer}</p>
              )}

              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link to="/shop?category=rudraksha" className="brand-gradient text-ivory px-6 py-3.5 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover-lift">
                  <ShieldCheck size={14} weight="duotone" /> Shop Rudraksha
                </Link>
                <button onClick={reset} data-testid="rudraksha-reset" className="border border-gold/40 text-ink-soft px-6 py-3.5 text-xs uppercase tracking-widest inline-flex items-center gap-2 hover:border-maroon hover:text-maroon transition-colors">
                  <ArrowCounterClockwise size={14} /> Calculate again
                </button>
              </div>
            </div>
          </Reveal>
        )}
      </div>
    </div>
  );
}
