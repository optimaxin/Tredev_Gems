import React, { useMemo } from "react";
import { useReducedMotion } from "framer-motion";
import { Sparkle } from "@phosphor-icons/react";

/* Small engraved yantra — two concentric rings + a rotated square, turning in
   opposite directions. Deliberately lighter than the ambassador-hero chakra:
   this sits small, in a corner, behind copy — not the main event. */
function Yantra() {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" aria-hidden="true">
      <g className="seal-spin" fill="none" stroke="#D4AF37" strokeWidth="1" opacity="0.5" style={{ transformBox: "fill-box" }}>
        <circle cx="100" cy="100" r="94" />
        <circle cx="100" cy="100" r="70" />
        <rect x="42" y="42" width="116" height="116" transform="rotate(45 100 100)" />
      </g>
      <g className="seal-spin-rev" fill="none" stroke="#F28C28" strokeWidth="1" opacity="0.4" style={{ transformBox: "fill-box" }}>
        <rect x="58" y="58" width="84" height="84" />
        <circle cx="100" cy="100" r="40" />
      </g>
    </svg>
  );
}

/* Shared left-hand visual for /login and /signup — dark maroon scene with a
   breathing halo, pulsing aura rings, a turning yantra, and rising embers,
   reusing the same keyframes as the ambassador hero so the brand's "sacred
   motion" language stays consistent site-wide. */
export default function AuthVisualPanel({ eyebrow, title, tagline, points = [] }) {
  const reduce = useReducedMotion();
  const embers = useMemo(
    () => Array.from({ length: 7 }).map((_, i) => ({
      left: `${10 + i * 12}%`,
      delay: `${(i * 0.9).toFixed(1)}s`,
      dur: `${6 + (i % 3)}s`,
      size: i % 3 === 0 ? 4 : 2.5,
    })),
    []
  );

  return (
    <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-maroon-deep text-ivory p-10 h-full" data-testid="auth-visual-panel">
      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 30% 20%, #4E1F26 0%, #2A1216 55%, #0B0605 100%)" }} />
      <div className="absolute inset-0 geom-bg opacity-70" />

      <div className="halo-breathe absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[110%] aspect-square rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(242,140,40,0.28) 0%, rgba(212,175,55,0.1) 40%, transparent 68%)" }} />

      {!reduce && [0, 1, 2].map((i) => (
        <div key={i} className="aura-ring absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] aspect-square rounded-full border border-gold/25 pointer-events-none"
          style={{ animationDelay: `${i * 2}s` }} />
      ))}

      <div className="absolute -right-16 -bottom-16 w-72 h-72 opacity-70 pointer-events-none">
        <Yantra />
      </div>

      {!reduce && embers.map((e, i) => (
        <span key={i} className="ember absolute rounded-full bg-gold pointer-events-none" style={{
          left: e.left, bottom: "6%", width: e.size, height: e.size,
          animationDelay: e.delay, animationDuration: e.dur,
          boxShadow: "0 0 8px rgba(242,140,40,0.9)",
        }} />
      ))}

      <div className="relative z-10 inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-gold w-fit border border-gold/40 px-3 py-1.5">
        <Sparkle size={14} weight="duotone" /> {eyebrow}
      </div>

      <div className="relative z-10">
        <h2 className="font-display text-4xl xl:text-5xl leading-[1.05] shimmer-text-gold">{title}</h2>
        <p className="mt-4 text-ivory/70 text-sm leading-relaxed max-w-sm">{tagline}</p>
        {points.length > 0 && (
          <ul className="mt-6 space-y-2">
            {points.map((p, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-ivory/60">
                <span className="w-1 h-1 rounded-full bg-gold" /> {p}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
