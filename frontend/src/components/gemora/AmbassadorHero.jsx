import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Sparkle, ArrowRight, Calendar } from "@phosphor-icons/react";
import { api } from "@/lib/api";

/* Built-in defaults — editable from Admin → Website (Ambassador section).
   Leave any field empty ("") to hide that line. */
const DEFAULT_AMBASSADOR = {
  eyebrow: "",
  name: "Shri Raghavendra",
  role: "The face of our faith",
  quote: "Every stone we bless carries the same truth we live by.",
  primaryCta: { label: "Shop his picks", href: "/shop" },
  secondaryCta: { label: "Book a consultation", href: "/consultation" },
};

// Route internally for "/..." links, open external "http(s)://" URLs in a new tab.
function SmartLink({ href, className, children, ...rest }) {
  const to = (href || "").trim();
  if (!to) return null;
  if (/^https?:\/\//i.test(to)) {
    return <a href={to} target="_blank" rel="noreferrer" className={className} {...rest}>{children}</a>;
  }
  return <Link to={to} className={className} {...rest}>{children}</Link>;
}

const SLIDES = [
  { src: "/ambassador/ambassador-1.v2.webp", alt: "Brand ambassador offering a blessing" },
  { src: "/ambassador/ambassador-3.v2.webp", alt: "Brand ambassador holding a sacred pendant" },
];

const ROTATE_MS = 5000;

/* Sudarshana-style chakra rendered as inline SVG so it stays crisp at any size. */
function Chakra() {
  const teeth = useMemo(() => Array.from({ length: 24 }), []);
  const spokes = useMemo(() => Array.from({ length: 24 }), []);
  const petals = useMemo(() => Array.from({ length: 12 }), []);
  const pt = (cx, cy, r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  return (
    <svg viewBox="0 0 400 400" className="w-full h-full" aria-hidden="true">
      <defs>
        <radialGradient id="chakraFill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F28C28" stopOpacity="0.0" />
          <stop offset="55%" stopColor="#D4AF37" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#F28C28" stopOpacity="0.7" />
        </radialGradient>
        <linearGradient id="chakraStroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F6D27A" />
          <stop offset="50%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#F28C28" />
        </linearGradient>
        <filter id="chakraGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer discus — rotates clockwise */}
      <g
        className="chakra-spin"
        fill="none"
        stroke="url(#chakraStroke)"
        filter="url(#chakraGlow)"
        style={{ transformBox: "fill-box" }}
      >
        <circle cx="200" cy="200" r="192" strokeWidth="1.2" opacity="0.55" />
        <circle cx="200" cy="200" r="150" strokeWidth="1.6" opacity="0.7" />
        <circle cx="200" cy="200" r="58" strokeWidth="2" opacity="0.85" />
        <circle cx="200" cy="200" r="30" strokeWidth="1.4" opacity="0.6" />
        {/* flame teeth around the rim */}
        {teeth.map((_, i) => {
          const d = i * 15;
          const [tx, ty] = pt(200, 200, 205, d);
          const [ax, ay] = pt(200, 200, 184, d - 3.4);
          const [bx, by] = pt(200, 200, 184, d + 3.4);
          return (
            <polygon
              key={`t${i}`}
              points={`${tx},${ty} ${ax},${ay} ${bx},${by}`}
              fill="url(#chakraStroke)"
              stroke="none"
              opacity="0.75"
            />
          );
        })}
        {/* spokes */}
        {spokes.map((_, i) => {
          const d = i * 15;
          const [x1, y1] = pt(200, 200, 60, d);
          const [x2, y2] = pt(200, 200, 148, d);
          return <line key={`s${i}`} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1.1" opacity="0.5" />;
        })}
      </g>

      {/* Inner lotus ring — rotates counter-clockwise */}
      <g
        className="chakra-spin-rev"
        stroke="url(#chakraStroke)"
        fill="url(#chakraFill)"
        style={{ transformBox: "fill-box" }}
      >
        {petals.map((_, i) => {
          const d = i * 30;
          const [tx, ty] = pt(200, 200, 128, d);
          const [lx, ly] = pt(200, 200, 96, d - 7);
          const [rx, ry] = pt(200, 200, 96, d + 7);
          return (
            <path
              key={`p${i}`}
              d={`M ${lx} ${ly} Q ${tx} ${ty} ${rx} ${ry} Z`}
              strokeWidth="1"
              opacity="0.6"
            />
          );
        })}
      </g>
    </svg>
  );
}

export default function AmbassadorHero() {
  const [idx, setIdx] = useState(0);
  const [ambassador, setAmbassador] = useState(DEFAULT_AMBASSADOR);
  const reduce = useReducedMotion();

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api.get("/site-content").then(({ data }) => {
      if (data?.home?.ambassador) setAmbassador((a) => ({ ...a, ...data.home.ambassador }));
    }).catch(() => {});
  }, []);

  const embers = useMemo(
    () =>
      Array.from({ length: 9 }).map((_, i) => ({
        left: `${8 + i * 10}%`,
        delay: `${(i * 0.8).toFixed(1)}s`,
        dur: `${6 + (i % 4)}s`,
        size: i % 3 === 0 ? 4 : 2.5,
      })),
    []
  );

  return (
    <section
      className="relative overflow-hidden bg-maroon-deep text-ivory"
      data-testid="ambassador-hero"
      aria-label="Brand ambassador"
    >
      {/* Deep radial base so the black-backed portrait melts into the scene */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 72% 45%, #0B0605 0%, #2A1216 45%, #4E1F26 100%)",
        }}
      />
      {/* faint sacred-geometry grain */}
      <div className="absolute inset-0 geom-bg opacity-60" />

      <div className="relative mx-auto max-w-7xl px-6 lg:px-10 grid lg:grid-cols-2 gap-10 items-center min-h-[92vh] lg:min-h-[88vh] py-16">
        {/* ── Copy ── */}
        <div className="order-2 lg:order-1 text-center lg:text-left">
          {ambassador.eyebrow && (
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-gold border border-gold/40 px-3 py-1.5">
              <Sparkle size={14} weight="duotone" /> {ambassador.eyebrow}
            </div>
          )}
          {ambassador.name && (
            <h1 className="mt-6 font-display text-5xl md:text-6xl lg:text-7xl leading-[1.03] text-ivory">
              {ambassador.name}
            </h1>
          )}
          {ambassador.role && (
            <div className="mt-3 font-serifd text-xl md:text-2xl text-gold-soft italic">{ambassador.role}</div>
          )}
          {ambassador.quote && (
            <p className="mt-6 text-base md:text-lg text-ivory/80 leading-relaxed max-w-xl mx-auto lg:mx-0">
              “{ambassador.quote}”
            </p>
          )}

          <div className="mt-9 flex flex-wrap gap-4 justify-center lg:justify-start">
            <SmartLink
              href={ambassador.primaryCta?.href || "/shop"}
              data-testid="ambassador-cta-shop"
              className="brand-gradient text-ivory px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover-lift"
            >
              {ambassador.primaryCta?.label || "Shop his picks"} <ArrowRight size={16} />
            </SmartLink>
            <SmartLink
              href={ambassador.secondaryCta?.href || "/consultation"}
              className="border border-gold text-gold px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover:bg-gold hover:text-maroon-deep transition-colors"
            >
              <Calendar size={16} weight="duotone" /> {ambassador.secondaryCta?.label || "Book a consultation"}
            </SmartLink>
          </div>

          {/* slide indicators */}
          <div className="mt-10 flex items-center gap-3 justify-center lg:justify-start">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                aria-label={`Show ambassador photo ${i + 1}`}
                onClick={() => setIdx(i)}
                data-testid={`ambassador-dot-${i}`}
                className={`h-[3px] transition-all ${i === idx ? "w-12 bg-gold" : "w-6 bg-gold/30 hover:bg-gold/60"}`}
              />
            ))}
          </div>
        </div>

        {/* ── Figure with chakra ── */}
        <div className="order-1 lg:order-2 relative flex items-center justify-center">
          <div className="relative w-full max-w-[520px] h-[440px] sm:h-[520px] lg:h-[640px]">
            {/* breathing halo glow */}
            <div
              className="halo-breathe absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[78%] aspect-square rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(242,140,40,0.45) 0%, rgba(212,175,55,0.18) 40%, transparent 68%)",
              }}
            />
            {/* pulsing aura rings */}
            {!reduce &&
              [0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="aura-ring absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] aspect-square rounded-full border border-gold/30"
                  style={{ animationDelay: `${i * 2}s` }}
                />
              ))}
            {/* rotating chakra — sits behind the figure */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[128%] aspect-square opacity-80 pointer-events-none">
              <Chakra />
            </div>

            {/* the ambassador — pre-cut PNG/WebP (transparent background) sits in front of the chakra */}
            <AnimatePresence>
              <motion.img
                key={idx}
                src={SLIDES[idx].src}
                alt={SLIDES[idx].alt}
                className="absolute inset-0 w-full h-full object-contain object-bottom"
                style={{ filter: "drop-shadow(0 24px 40px rgba(0,0,0,0.55))" }}
                initial={{ opacity: 0, scale: reduce ? 1 : 1.05 }}
                animate={{ opacity: 1, scale: reduce ? 1 : [1.05, 1.0] }}
                exit={{ opacity: 0 }}
                transition={{
                  opacity: { duration: 1.1, ease: "easeInOut" },
                  scale: { duration: ROTATE_MS / 1000, ease: "linear" },
                }}
              />
            </AnimatePresence>

            {/* rising gold embers */}
            {!reduce &&
              embers.map((e, i) => (
                <span
                  key={i}
                  className="ember absolute rounded-full bg-gold"
                  style={{
                    left: e.left,
                    bottom: "8%",
                    width: e.size,
                    height: e.size,
                    animationDelay: e.delay,
                    animationDuration: e.dur,
                    boxShadow: "0 0 8px rgba(242,140,40,0.9)",
                  }}
                />
              ))}
          </div>
        </div>
      </div>

      {/* gold seam into the rest of the page */}
      <div className="brand-gradient h-[2px] w-full relative" />
    </section>
  );
}
