import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/api";
import ProductCard from "@/components/gemora/ProductCard";
import { Flourish } from "@/components/gemora/Ornament";
import {
  copyFor, faqFor, prettyKey, prettyValue, CATEGORY_LABEL, CATEGORY_DEVA,
} from "@/lib/productCopy";
import {
  ShieldCheck, Certificate, QrCode, Fingerprint, HandHeart, Sparkle, Truck, Package,
  CreditCard, ArrowsClockwise, ChatCircle, Phone, CalendarBlank, Star, Compass,
  CaretRight, ArrowRight, FlowerLotus, Drop, Sun, Moon, Leaf, Clock, Ruler, Scroll,
} from "@phosphor-icons/react";

/* copy uses string keys so the copy file stays data-only */
const ICONS = {
  drop: Drop, sun: Sun, moon: Moon, leaf: Leaf, lotus: FlowerLotus, hand: HandHeart,
  shield: ShieldCheck, qr: QrCode, sparkle: Sparkle, compass: Compass, ruler: Ruler,
  package: Package, clock: Clock, scroll: Scroll,
};
const Ico = ({ name, ...rest }) => {
  const C = ICONS[name] || Sparkle;
  return <C {...rest} />;
};

/* Centred section head that wraps safely on small screens (unlike OrnamentHeader,
   which pins its title to a single line). */
const SectionHead = ({ eyebrow, title }) => (
  <div className="text-center">
    {eyebrow && <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">{eyebrow}</div>}
    <div className="mt-3 flex items-center justify-center gap-4 text-gold-soft">
      <Flourish className="hidden sm:block w-16 lg:w-24 h-2 opacity-70 shrink-0" />
      <h2 className="font-display text-4xl md:text-5xl text-ink">{title}</h2>
      <Flourish className="hidden sm:block w-16 lg:w-24 h-2 opacity-70 -scale-x-100 shrink-0" />
    </div>
  </div>
);

const Reveal = ({ children, delay = 0, className = "" }) => (
  <motion.div
    initial={{ opacity: 0, y: 18 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-70px" }}
    transition={{ duration: 0.55, delay, ease: "easeOut" }}
    className={className}
  >
    {children}
  </motion.div>
);

/* ── 1. Moving trust strip ─────────────────────────────────────────── */
const TRUST = [
  [ShieldCheck, "Guarantee of Purity"],
  [Certificate, "100% Lab-Certified"],
  [HandHeart, "Ethically Sourced"],
  [FlowerLotus, "Temple Energised"],
  [Fingerprint, "Ed25519 Signed"],
  [Truck, "Free Insured Shipping"],
  [ArrowsClockwise, "7-Day Returns"],
];
function TrustMarquee() {
  return (
    <div className="trust-marquee-wrap bg-cream border-y border-gold/30 overflow-hidden" aria-label="Our guarantees">
      <div className="flex whitespace-nowrap py-4 trust-marquee-track">
        {TRUST.concat(TRUST).map(([I, label], i) => (
          <div key={i} className="flex items-center gap-2.5 px-8 shrink-0">
            <I size={20} weight="duotone" className="text-gold-soft" />
            <span className="text-sm text-ink-soft tracking-wide">{label}</span>
            <Sparkle size={10} weight="fill" className="text-gold/50 ml-6" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 2. Specs — driven entirely by the product's own attrs ─────────── */
function Specs({ p }) {
  const rows = Object.entries(p.attrs || {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);
  if (!rows.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
      <SectionHead eyebrow={`${CATEGORY_LABEL[p.category] || "Details"} · ${CATEGORY_DEVA[p.category] || "विवरण"}`} title="The details, on record" />
      <div className="mt-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {rows.map(([k, v], i) => (
          <Reveal key={k} delay={i * 0.05}>
            <div className="gold-line bg-ivory p-5 h-full relative overflow-hidden group hover-lift">
              <div className="absolute inset-x-0 top-0 h-[2px] brand-gradient opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="text-[10px] uppercase tracking-widest text-ink-muted">{prettyKey(k)}</div>
              <div className="font-serifd text-xl text-maroon-deep mt-1.5 capitalize leading-snug">{prettyValue(v)}</div>
            </div>
          </Reveal>
        ))}
        <Reveal delay={rows.length * 0.05}>
          <div className="gold-line-strong bg-cream p-5 h-full flex flex-col justify-center">
            <Fingerprint size={22} weight="duotone" className="text-gold-soft" />
            <div className="text-[10px] uppercase tracking-widest text-ink-muted mt-2">Serial</div>
            <div className="font-mono text-sm text-maroon-deep mt-1">Assigned at dispatch</div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── 3. Benefits — category-aware ──────────────────────────────────── */
function Benefits({ p, copy }) {
  const purpose = p.attrs?.purpose;
  return (
    <section className="bg-cream border-y border-gold/30 py-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Why it matters · महत्त्व</div>
        <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">{copy.benefitsTitle}</h2>
        {purpose && (
          <p className="mt-3 text-sm text-ink-soft max-w-2xl">
            Chosen by seekers for <span className="text-maroon capitalize">{prettyValue(purpose)}</span>.
          </p>
        )}
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {copy.benefits.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.08}>
              <div className="gold-line bg-ivory p-6 h-full relative hover-lift">
                <div className="absolute -top-3 left-6 brand-gradient text-ivory text-[10px] tracking-widest px-2 py-0.5 uppercase font-mono">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <Ico name={b.icon} size={30} weight="duotone" className="text-gold-soft mt-3" />
                <div className="font-serifd text-xl text-maroon-deep mt-3 leading-snug">{b.title}</div>
                <p className="text-sm text-ink-soft mt-2 leading-relaxed">{b.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 4. Provenance band — the immersive one ────────────────────────── */
const CHAIN = [
  { Icon: Package, title: "Intake & Vault", body: "Photographed, weighed and X-rayed where needed, then stored in the Tredev vault." },
  { Icon: Certificate, title: "Lab Report", body: "A report from a GJEPC-affiliated laboratory is attached to the unit at intake." },
  { Icon: FlowerLotus, title: "Temple Energisation", body: "A priest performs a pooja on your exact unit — recorded, and signed by him." },
  { Icon: Fingerprint, title: "Ed25519 Signature", body: "Canonical JSON hashed with SHA-256 and signed with our vaulted private key." },
  { Icon: QrCode, title: "QR Activation", body: "The per-unit QR goes live the moment we physically dispatch it to you." },
];

function Mandala({ className = "" }) {
  const spokes = useMemo(() => Array.from({ length: 32 }), []);
  const pt = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [200 + r * Math.cos(a), 200 + r * Math.sin(a)];
  };
  return (
    <svg viewBox="0 0 400 400" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F6D27A" />
          <stop offset="50%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#F28C28" />
        </linearGradient>
      </defs>
      <g className="chakra-spin" fill="none" stroke="url(#mg)" style={{ transformBox: "fill-box" }}>
        <circle cx="200" cy="200" r="196" strokeWidth="1" opacity="0.4" />
        <circle cx="200" cy="200" r="150" strokeWidth="1" opacity="0.5" />
        <circle cx="200" cy="200" r="96" strokeWidth="1" opacity="0.6" />
        {spokes.map((_, i) => {
          const d = i * 11.25;
          const [x1, y1] = pt(96, d);
          const [x2, y2] = pt(196, d);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="0.7" opacity="0.35" />;
        })}
      </g>
      <g className="chakra-spin-rev" fill="none" stroke="url(#mg)" style={{ transformBox: "fill-box" }}>
        {Array.from({ length: 8 }).map((_, i) => {
          const d = i * 45;
          const [tx, ty] = pt(120, d);
          const [lx, ly] = pt(70, d - 16);
          const [rx, ry] = pt(70, d + 16);
          return <path key={i} d={`M ${lx} ${ly} Q ${tx} ${ty} ${rx} ${ry} Z`} strokeWidth="0.9" opacity="0.5" />;
        })}
      </g>
    </svg>
  );
}

function ProvenanceBand({ reduce }) {
  return (
    <section className="relative overflow-hidden bg-maroon-deep text-ivory py-24">
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: "url('https://images.pexels.com/photos/15286007/pexels-photo-15286007.jpeg')", backgroundSize: "cover", backgroundPosition: "center" }}
      />
      {/* drifting mandala */}
      <div className={`absolute -right-32 top-1/2 -translate-y-1/2 w-[620px] h-[620px] opacity-25 pointer-events-none ${reduce ? "" : "drift-slow"}`}>
        <Mandala className="w-full h-full" />
      </div>
      {/* embers */}
      {!reduce &&
        Array.from({ length: 7 }).map((_, i) => (
          <span
            key={i}
            className="ember absolute rounded-full bg-gold"
            style={{
              left: `${6 + i * 13}%`, bottom: "10%", width: i % 2 ? 3 : 4, height: i % 2 ? 3 : 4,
              animationDelay: `${i * 0.9}s`, animationDuration: `${7 + (i % 3)}s`,
              boxShadow: "0 0 8px rgba(242,140,40,0.9)",
            }}
          />
        ))}

      <div className="relative mx-auto max-w-7xl px-6 lg:px-10">
        <div className="text-xs uppercase tracking-[0.3em] text-gold">The provenance chain · प्रमाण</div>
        <h2 className="font-display text-4xl md:text-5xl mt-3 leading-tight max-w-2xl">
          Five steps between the mine and your hand.
        </h2>
        <p className="mt-5 text-ivory/80 max-w-2xl leading-relaxed">
          Anyone can claim a piece is real. Every step below leaves a signed record, so this one can be proven — by you, a jeweller, or a stranger with the public key.
        </p>

        <div className="mt-14 relative">
          {/* the drawn line */}
          <div className="hidden lg:block absolute left-0 right-0 top-7 h-[1px] bg-gold/30" />
          <div className="grid gap-8 lg:grid-cols-5">
            {CHAIN.map(({ Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 0.1}>
                <div className="relative">
                  <div className="w-14 h-14 rounded-full border border-gold/50 bg-maroon-deep flex items-center justify-center relative z-10">
                    <Icon size={24} weight="duotone" className="text-gold" />
                    {!reduce && (
                      <span className="aura-ring absolute inset-0 rounded-full border border-gold/40" style={{ animationDelay: `${i * 1.2}s` }} />
                    )}
                  </div>
                  <div className="mt-4 text-[10px] font-mono tracking-widest text-gold/70">STEP {i + 1}</div>
                  <div className="font-serifd text-xl mt-1">{title}</div>
                  <p className="text-sm text-ivory/70 mt-2 leading-relaxed">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <Link
          to="/verify"
          className="mt-14 inline-flex items-center gap-2 border border-gold text-gold px-7 py-3.5 text-sm uppercase tracking-widest hover:bg-gold hover:text-maroon-deep transition-colors"
        >
          <QrCode size={16} weight="duotone" /> See how verification works
        </Link>
      </div>
    </section>
  );
}

/* ── 5. Ritual — category-aware ────────────────────────────────────── */
function Ritual({ copy }) {
  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
      <SectionHead eyebrow={`Ritual · ${copy.ritualDeva || "विधि"}`} title={copy.ritualTitle} />
      <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {copy.ritual.map((s, i) => (
          <Reveal key={s.title} delay={i * 0.08}>
            <div className="relative gold-line-strong bg-ivory p-6 h-full hover-lift">
              <div className="flex items-center justify-between">
                <Ico name={s.icon} size={28} weight="duotone" className="text-gold-soft" />
                <span className="font-display text-4xl text-cream select-none">{i + 1}</span>
              </div>
              <div className="font-serifd text-xl text-maroon-deep mt-3">{s.title}</div>
              <p className="text-sm text-ink-soft mt-2 leading-relaxed">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ── 6. Care — real care_instructions win; copy is the fallback ────── */
function CareGuide({ p, copy }) {
  const custom = (p.care_instructions || []).filter(Boolean);
  const items = custom.length
    ? custom.map((line, i) => ({ icon: ["drop", "leaf", "package", "hand"][i % 4], title: null, body: line }))
    : copy.care;
  return (
    <section className="bg-cream border-y border-gold/30 py-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Care & wear · देखभाल</div>
        <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">Keep it as it reached you</h2>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {items.map((c, i) => (
            <Reveal key={i} delay={i * 0.07}>
              <div className="gold-line bg-ivory p-6 h-full">
                <Ico name={c.icon} size={26} weight="duotone" className="text-gold-soft" />
                {c.title && <div className="font-serifd text-lg text-maroon-deep mt-3">{c.title}</div>}
                <p className={`text-sm text-ink-soft leading-relaxed ${c.title ? "mt-1.5" : "mt-3"}`}>{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 7. Reviews with a rating breakdown ────────────────────────────── */
function Reviews({ reviews }) {
  const n = reviews.length;
  const avg = n ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / n : 0;
  const buckets = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));
  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20" id="reviews">
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">In their words · ग्राहक</div>
      <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">What seekers say</h2>

      {n === 0 ? (
        <div className="mt-8 gold-line bg-ivory p-10 text-center text-ink-muted">
          No reviews yet — yours would be the first.
        </div>
      ) : (
        <div className="mt-10 grid lg:grid-cols-[300px_1fr] gap-10">
          <Reveal>
            <div className="gold-line-strong bg-cream p-6 h-fit">
              <div className="font-display text-6xl text-maroon-deep leading-none">{avg.toFixed(1)}</div>
              <div className="flex gap-0.5 text-gold mt-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={16} weight={i < Math.round(avg) ? "fill" : "regular"} />
                ))}
              </div>
              <div className="text-xs text-ink-muted mt-2">Based on {n} verified {n === 1 ? "review" : "reviews"}</div>
              <div className="mt-5 space-y-2">
                {buckets.map((b) => (
                  <div key={b.star} className="flex items-center gap-2">
                    <span className="text-[11px] text-ink-muted w-3">{b.star}</span>
                    <Star size={10} weight="fill" className="text-gold-soft" />
                    <div className="flex-1 h-1.5 bg-sand overflow-hidden">
                      <motion.div
                        className="h-full brand-gradient"
                        initial={{ width: 0 }}
                        whileInView={{ width: `${n ? (b.count / n) * 100 : 0}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.9, ease: "easeOut" }}
                      />
                    </div>
                    <span className="text-[11px] text-ink-muted w-5 text-right">{b.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
          <div className="grid md:grid-cols-2 gap-5">
            {reviews.map((r, i) => (
              <Reveal key={r.review_id || i} delay={i * 0.06}>
                <div className="gold-line bg-ivory p-6 h-full">
                  <div className="flex gap-0.5 text-gold">
                    {Array.from({ length: r.rating || 0 }).map((_, k) => <Star key={k} size={13} weight="fill" />)}
                  </div>
                  {r.title && <div className="font-serifd text-lg text-ink mt-2">{r.title}</div>}
                  <p className="text-sm text-ink-soft mt-2 leading-relaxed">“{r.body}”</p>
                  <div className="mt-4 text-xs text-ink-muted flex items-center gap-2">
                    <ChatCircle size={12} weight="duotone" /> {r.author}
                    <span className="text-verified inline-flex items-center gap-1 ml-auto">
                      <ShieldCheck size={11} weight="duotone" /> Verified buyer
                    </span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ── 8. Consultation banner ────────────────────────────────────────── */
function ConsultBanner() {
  return (
    <section className="relative overflow-hidden bg-maroon-deep text-ivory py-16">
      <div className="absolute inset-0 geom-bg opacity-40" />
      <div className="relative mx-auto max-w-7xl px-6 lg:px-10 grid lg:grid-cols-[1fr_auto] gap-10 items-center">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold">Guidance · परामर्श</div>
          <h2 className="font-display text-3xl md:text-4xl mt-2 leading-tight">
            Not sure this is the right one for you?
          </h2>
          <p className="text-sm text-ivory/80 mt-3 max-w-2xl">
            Talk to a verified astrologer before you buy — a human, on a scheduled call. They will read your chart and tell you honestly if this piece suits you, or if something else does.
          </p>
          <div className="mt-6 flex flex-wrap gap-6">
            {[[CalendarBlank, "Scheduled call"], [Compass, "Personalised advice"], [Sparkle, "Member discounts"]].map(([I, t]) => (
              <div key={t} className="flex items-center gap-2 text-sm text-ivory/85">
                <I size={16} weight="duotone" className="text-gold" /> {t}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Link to="/consultation" className="brand-gradient text-ivory px-7 py-3.5 text-xs uppercase tracking-widest hover-lift flex items-center justify-center gap-2">
            <Phone size={14} weight="duotone" /> Book a consultation
          </Link>
          <Link to="/tools/carat-ratti" className="border border-gold text-gold px-7 py-3.5 text-xs uppercase tracking-widest hover:bg-gold hover:text-maroon-deep transition-colors text-center">
            Free carat ↔ ratti tool
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── 9. Policies ───────────────────────────────────────────────────── */
const POLICIES = [
  { Icon: Truck, title: "Shipping", body: "Free insured shipping across India, dispatched within 48 hours and fully tracked. Worldwide delivery available; duties borne by the buyer.", to: "/verify" },
  { Icon: ArrowsClockwise, title: "Returns", body: "7 days from delivery, in original condition with the certificate. On return the certificate is revoked — its QR reads REVOKED forever.", to: "/verify" },
  { Icon: CreditCard, title: "Payment", body: "UPI, all major cards, net banking and wallets via Razorpay. Prepaid orders carry a 5% discount. No card details ever touch our servers.", to: "/checkout" },
];
function Policies() {
  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
      <div className="grid md:grid-cols-3 gap-5">
        {POLICIES.map(({ Icon, title, body, to }, i) => (
          <Reveal key={title} delay={i * 0.08}>
            <div className="gold-line bg-ivory p-7 h-full flex flex-col hover-lift">
              <Icon size={30} weight="duotone" className="text-gold-soft" />
              <div className="font-serifd text-2xl text-maroon-deep mt-3">{title}</div>
              <p className="text-sm text-ink-soft mt-2 leading-relaxed flex-1">{body}</p>
              <Link to={to} className="mt-5 text-[11px] uppercase tracking-widest text-maroon inline-flex items-center gap-1 hover:text-maroon-deep">
                Learn more <ArrowRight size={11} />
              </Link>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ── 10. FAQ ───────────────────────────────────────────────────────── */
function Faq({ p }) {
  const items = faqFor(p.category);
  const [open, setOpen] = useState(0);
  return (
    <section className="bg-cream border-y border-gold/30 py-20">
      <div className="mx-auto max-w-4xl px-6 lg:px-10">
        <div className="text-center">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Straight answers · प्रश्न</div>
          <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">Frequently asked</h2>
        </div>
        <div className="mt-10 gold-line bg-ivory divide-y divide-gold/20">
          {items.map((f, i) => (
            <details
              key={i}
              open={open === i}
              onToggle={(e) => e.target.open && setOpen(i)}
              className="p-5 group"
              data-testid={`product-faq-${i}`}
            >
              <summary className="cursor-pointer flex items-center justify-between gap-4 list-none">
                <span className="font-serifd text-lg text-ink">{f.q}</span>
                <CaretRight size={16} weight="bold" className="text-gold-soft group-open:rotate-90 transition-transform shrink-0" />
              </summary>
              <p className="mt-3 text-sm text-ink-soft leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org", "@type": "FAQPage",
            mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
          }) }}
        />
      </div>
    </section>
  );
}

/* ── 11. Related, from the same category ───────────────────────────── */
function Related({ p }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    api.get(`/products?category=${encodeURIComponent(p.category)}&limit=10`)
      .then(({ data }) => alive && setItems((data || []).filter((x) => x.slug !== p.slug).slice(0, 4)))
      .catch(() => {});
    return () => { alive = false; };
  }, [p.category, p.slug]);

  if (!items.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">You may also like · और भी</div>
          <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">
            More {(CATEGORY_LABEL[p.category] || "pieces").toLowerCase()}
          </h2>
        </div>
        <Link to={`/shop?category=${p.category}`} className="text-sm text-maroon underline underline-offset-4 decoration-gold-soft shrink-0">
          View all →
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {items.map((x) => <ProductCard key={x.product_id} p={x} />)}
      </div>
    </section>
  );
}

/* ── The story ─────────────────────────────────────────────────────── */
export default function ProductStory({ p, reviews = [] }) {
  const reduce = useReducedMotion();
  const copy = copyFor(p.category);
  return (
    <>
      <TrustMarquee />
      <Specs p={p} />
      <Benefits p={p} copy={copy} />
      <ProvenanceBand reduce={reduce} />
      <Ritual copy={copy} />
      <CareGuide p={p} copy={copy} />
      <Reviews reviews={reviews} />
      <ConsultBanner />
      <Policies />
      <Faq p={p} />
      <Related p={p} />
    </>
  );
}
