import React, { useId, useMemo } from "react";

/**
 * A premium, embossed wax-stamp authenticity seal with the verification code in the
 * centre. Layered like an engraved notarial seal: gold-gradient rings, a beaded
 * border, a slowly-turning guilloché (wavy engraving), curved "TREDEV · CERTIFIED"
 * over the top and "AUTHENTICITY SEAL" under the bottom, and the code embossed in the
 * middle. `dark` styles it for a dark background.
 */
export default function Seal({ code, size = 116, dark = false }) {
  const uid = useId().replace(/:/g, ""); // unique, stable ids for this instance
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 2;

  // Palette — gold on dark, deep-maroon-and-gold on light.
  const g1 = dark ? "#FBEFC6" : "#E6C766";
  const g2 = dark ? "#EBCB76" : "#C9A227";
  const g3 = dark ? "#C79A3C" : "#8A6A16";
  const ink = dark ? "#F3E4B8" : "#722F37"; // curved text + code
  const bead = dark ? "#EBCB76" : "#C9A227";

  const pt = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  // Beaded border ring.
  const beads = useMemo(() => {
    const rB = R - 4.5;
    const n = Math.round(size / 2.1);
    return Array.from({ length: n }, (_, i) => pt(rB, (360 / n) * i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // Guilloché — a sine-modulated ring that reads as fine engraving.
  const guilloche = useMemo(() => {
    const base = R - 18;
    const amp = size * 0.014;
    const lobes = 30;
    let d = "";
    for (let t = 0; t <= 360; t += 2) {
      const rr = base + amp * Math.sin((lobes * t * Math.PI) / 180);
      const [x, y] = pt(rr, t);
      d += `${t === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    return d + "Z";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // Curved-text arcs (top bulges up, bottom bulges down; both left→right so upright).
  const arcR = R - 10;
  const topArc = `M ${cx - arcR} ${cy} A ${arcR} ${arcR} 0 0 1 ${cx + arcR} ${cy}`;
  const botArc = `M ${cx - arcR} ${cy} A ${arcR} ${arcR} 0 0 0 ${cx + arcR} ${cy}`;

  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      role="img" aria-label={`Authenticity seal, code ${code}`}
      style={{ filter: dark ? "drop-shadow(0 3px 10px rgba(0,0,0,0.45))" : "drop-shadow(0 3px 8px rgba(114,47,55,0.20))" }}
    >
      <defs>
        <linearGradient id={`gold-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={g1} />
          <stop offset="50%" stopColor={g2} />
          <stop offset="100%" stopColor={g3} />
        </linearGradient>
        <radialGradient id={`sheen-${uid}`} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor={dark ? "#FFF6DC" : "#FBF6E4"} stopOpacity={dark ? 0.16 : 0.5} />
          <stop offset="55%" stopColor={dark ? "#FFF6DC" : "#FBF6E4"} stopOpacity="0" />
        </radialGradient>
        {/* darkens/lightens the very centre so the code reads cleanly against the engraving */}
        <radialGradient id={`core-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={dark ? "#2A1016" : "#FBF6E4"} stopOpacity={dark ? 0.72 : 0.85} />
          <stop offset="70%" stopColor={dark ? "#2A1016" : "#FBF6E4"} stopOpacity={dark ? 0.72 : 0.85} />
          <stop offset="100%" stopColor={dark ? "#2A1016" : "#FBF6E4"} stopOpacity="0" />
        </radialGradient>
        <filter id={`emboss-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <path id={`top-${uid}`} d={topArc} />
        <path id={`bot-${uid}`} d={botArc} />
      </defs>

      {/* faint medallion sheen for depth */}
      <circle cx={cx} cy={cy} r={R} fill={`url(#sheen-${uid})`} />

      <g filter={`url(#emboss-${uid})`}>
        {/* outer bold ring + fine ring */}
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={`url(#gold-${uid})`} strokeWidth="2.2" />
        <circle cx={cx} cy={cy} r={R - 2.4} fill="none" stroke={g3} strokeWidth="0.5" opacity="0.7" />

        {/* beaded border */}
        {beads.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={size * 0.007 + 0.3} fill={bead} opacity="0.9" />
        ))}

        {/* turning guilloché engraving around the medallion */}
        <path className="seal-spin-rev" d={guilloche} fill="none" stroke={`url(#gold-${uid})`} strokeWidth="0.6" opacity="0.75" />

        {/* inner ring enclosing the medallion */}
        <circle cx={cx} cy={cy} r={R - 13} fill="none" stroke={`url(#gold-${uid})`} strokeWidth="1.3" />
      </g>

      {/* clean medallion behind the code */}
      <circle cx={cx} cy={cy} r={R - 20} fill={`url(#core-${uid})`} />

      {/* curved labels */}
      <text fill={ink} fontSize={size * 0.066} fontWeight="600" letterSpacing="1.7" style={{ fontFamily: "Georgia, 'Cormorant Garamond', serif" }}>
        <textPath href={`#top-${uid}`} startOffset="50%" textAnchor="middle">TREDEV · CERTIFIED</textPath>
      </text>
      <text fill={ink} fontSize={size * 0.062} letterSpacing="2" style={{ fontFamily: "Georgia, 'Cormorant Garamond', serif" }}>
        <textPath href={`#bot-${uid}`} startOffset="50%" textAnchor="middle">AUTHENTICITY SEAL</textPath>
      </text>

      {/* ornament + flanking rules above the code */}
      <text x={cx} y={cy - size * 0.13} textAnchor="middle" fill={bead} fontSize={size * 0.095}>✦</text>
      <line x1={cx - size * 0.23} y1={cy - size * 0.055} x2={cx - size * 0.10} y2={cy - size * 0.055} stroke={bead} strokeWidth="0.7" opacity="0.85" />
      <line x1={cx + size * 0.10} y1={cy - size * 0.055} x2={cx + size * 0.23} y2={cy - size * 0.055} stroke={bead} strokeWidth="0.7" opacity="0.85" />

      {/* embossed code — a soft shadow twin behind for depth */}
      <text x={cx} y={cy + size * 0.07 + 0.8} textAnchor="middle" fill={dark ? "#000" : "#722F37"} opacity={dark ? 0.4 : 0.12}
        fontSize={size * 0.17} fontWeight="700" letterSpacing="1" style={{ fontFamily: "Georgia, 'Cormorant Garamond', serif" }}>
        {code}
      </text>
      <text x={cx} y={cy + size * 0.07} textAnchor="middle" fill={ink}
        fontSize={size * 0.17} fontWeight="700" letterSpacing="1" style={{ fontFamily: "Georgia, 'Cormorant Garamond', serif" }}>
        {code}
      </text>

      <text x={cx} y={cy + size * 0.185} textAnchor="middle" fill={bead} fontSize={size * 0.05} letterSpacing="2.4">VERIFY CODE</text>
    </svg>
  );
}
