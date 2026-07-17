import React, { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion, useScroll, useTransform } from "framer-motion";

/**
 * Editorial (magazine) primitives for the homepage.
 *
 * The house style is print, not product-page: asymmetric rules, Devanagari
 * section marks, drop caps and pull quotes. Deliberately avoids the glass /
 * aurora-gradient vocabulary — that reads as template, and Tredev is not one.
 */

/* ०१ — Devanagari numerals as section marks. */
const DEVA_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
export const toDeva = (n) =>
  String(n).split("").map((d) => (/\d/.test(d) ? DEVA_DIGITS[Number(d)] : d)).join("");

/* Reveal-on-scroll. Falls back to visible if the observer never fires. */
export function Reveal({ children, delay = 0, y = 20, className = "" }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [0.2, 0.8, 0.2, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* A numbered editorial section head with a rule that draws itself in. */
export function SectionMark({ n, eyebrow, title, sub, align = "left", className = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <div ref={ref} className={`${align === "center" ? "text-center" : ""} ${className}`}>
      <div className={`flex items-baseline gap-4 ${align === "center" ? "justify-center" : ""}`}>
        {n != null && (
          <span className="font-deva text-2xl text-gold-soft/70 tabular-nums select-none">{toDeva(String(n).padStart(2, "0"))}</span>
        )}
        <span className="text-xs uppercase tracking-[0.3em] text-gold-soft">{eyebrow}</span>
      </div>
      <div className={`mt-3 h-[1px] bg-gold/40 ${inView ? "rule-draw" : ""}`} style={{ transform: inView ? undefined : "scaleX(0)", transformOrigin: "left" }} />
      <h2 className="font-display text-4xl md:text-5xl text-ink mt-5 leading-tight">{title}</h2>
      {sub && <p className={`mt-3 text-sm text-ink-soft leading-relaxed ${align === "center" ? "mx-auto" : ""} max-w-2xl`}>{sub}</p>}
    </div>
  );
}

/* Print drop cap — the styling lives in index.css so ::first-letter applies. */
export function DropCap({ children, className = "" }) {
  return <p className={`drop-cap text-ink-soft leading-relaxed ${className}`}>{children}</p>;
}

/* A set pull quote, the way a magazine breaks a column. */
export function PullQuote({ children, cite, deva }) {
  return (
    <figure className="relative py-2 pl-6 border-l-2 border-gold">
      {deva && <div className="font-deva text-lg text-gold-soft mb-2">{deva}</div>}
      <blockquote className="font-serifd text-2xl md:text-3xl text-maroon-deep leading-snug italic">
        {children}
      </blockquote>
      {cite && <figcaption className="mt-3 text-xs uppercase tracking-widest text-ink-muted">— {cite}</figcaption>}
    </figure>
  );
}

/* Counts up once, when it scrolls into view. */
export function CountUp({ to, decimals = 0, prefix = "", suffix = "", duration = 1600, className = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) { setV(to); return; }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      // ease-out cubic — fast start, settles rather than stops dead
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration, reduce]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}{v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
    </span>
  );
}

/* A slow Devanagari ticker used as a section divider. */
const MANTRAS = [
  "सत्यम् एव जयते", "न हि सत्यात् परो धर्मः", "ॐ नमः शिवाय", "शुभम् भवतु",
  "असतो मा सद्गमय", "सर्वे भवन्तु सुखिनः",
];
export function MantraDivider() {
  return (
    <div className="relative bg-maroon-deep text-ivory/70 overflow-hidden border-y border-gold/30" aria-hidden="true">
      <div className="grain absolute inset-0" />
      <div className="flex whitespace-nowrap py-3 mantra-track">
        {MANTRAS.concat(MANTRAS).map((m, i) => (
          <span key={i} className="px-10 font-deva text-lg shrink-0">
            {m}<span className="text-gold/50 ml-10">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* Scroll-linked parallax for editorial imagery. */
export function Parallax({ children, distance = 60, className = "" }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  return (
    <div ref={ref} className={`relative overflow-hidden ${className}`}>
      <motion.div style={reduce ? undefined : { y }} className="w-full h-full">
        {children}
      </motion.div>
    </div>
  );
}

/* The turning yantra watermark behind the hero. */
export function YantraWatermark({ className = "" }) {
  const pt = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [200 + r * Math.cos(a), 200 + r * Math.sin(a)];
  };
  const tri = (r, rot) =>
    [0, 120, 240].map((d) => pt(r, d + rot).join(",")).join(" ");
  return (
    <svg viewBox="0 0 400 400" className={className} aria-hidden="true">
      <g className="yantra-turn" fill="none" stroke="currentColor" strokeWidth="0.8" style={{ transformBox: "fill-box" }}>
        <circle cx="200" cy="200" r="190" />
        <circle cx="200" cy="200" r="150" />
        <circle cx="200" cy="200" r="96" />
        {/* interlocking triangles — the classical shri-yantra gesture, not a mandala cliché */}
        <polygon points={tri(150, 0)} />
        <polygon points={tri(150, 60)} />
        <polygon points={tri(110, 30)} />
        <polygon points={tri(110, 90)} />
        {/* lotus petals on the outer ring */}
        {Array.from({ length: 16 }).map((_, i) => {
          const d = i * 22.5;
          const [tx, ty] = pt(190, d);
          const [lx, ly] = pt(152, d - 10);
          const [rx, ry] = pt(152, d + 10);
          return <path key={i} d={`M ${lx} ${ly} Q ${tx} ${ty} ${rx} ${ry}`} />;
        })}
      </g>
    </svg>
  );
}
