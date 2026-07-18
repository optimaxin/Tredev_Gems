import React, { useId } from "react";

/**
 * A round, wax-stamp-style authenticity seal with the verification code in the centre.
 * Curved "TREDEV · CERTIFIED" over the top, "AUTHENTICITY SEAL" under the bottom, a
 * small emblem, and the code big in the middle. `dark` styles it for a dark background.
 */
export default function Seal({ code, size = 116, dark = false }) {
  const uid = useId().replace(/:/g, ""); // unique, stable path ids for this instance
  const ink = dark ? "#EBCB76" : "#722F37";     // rings + main text
  const accent = dark ? "#F4E4BC" : "#C9A227";  // dashed ring + emblem + sub-label
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;
  const arcR = r - 11;
  // Top arc bulges up (sweep 1), bottom arc bulges down (sweep 0); both drawn left→right
  // so the curved text reads upright on both.
  const topArc = `M ${cx - arcR} ${cy} A ${arcR} ${arcR} 0 0 1 ${cx + arcR} ${cy}`;
  const botArc = `M ${cx - arcR} ${cy} A ${arcR} ${arcR} 0 0 0 ${cx + arcR} ${cy}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Authenticity seal, code ${code}`}>
      <defs>
        <path id={`top-${uid}`} d={topArc} />
        <path id={`bot-${uid}`} d={botArc} />
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={ink} strokeWidth="2" />
      <circle cx={cx} cy={cy} r={r - 4} fill="none" stroke={accent} strokeWidth="0.75" strokeDasharray="1.5 2.5" />

      <text fill={ink} fontSize="7.5" fontWeight="600" letterSpacing="1.8" style={{ fontFamily: "Georgia, serif" }}>
        <textPath href={`#top-${uid}`} startOffset="50%" textAnchor="middle">TREDEV · CERTIFIED</textPath>
      </text>
      <text fill={ink} fontSize="7" letterSpacing="2" style={{ fontFamily: "Georgia, serif" }}>
        <textPath href={`#bot-${uid}`} startOffset="50%" textAnchor="middle">AUTHENTICITY SEAL</textPath>
      </text>

      {/* emblem + divider lines flanking the code */}
      <text x={cx} y={cy - 15} textAnchor="middle" fill={accent} fontSize="10">✦</text>
      <line x1={cx - 26} y1={cy - 6} x2={cx - 12} y2={cy - 6} stroke={accent} strokeWidth="0.75" />
      <line x1={cx + 12} y1={cy - 6} x2={cx + 26} y2={cy - 6} stroke={accent} strokeWidth="0.75" />

      <text x={cx} y={cy + 8} textAnchor="middle" fill={ink} fontSize="18" fontWeight="700" letterSpacing="1.5" style={{ fontFamily: "Georgia, serif" }}>
        {code}
      </text>
      <text x={cx} y={cy + 19} textAnchor="middle" fill={accent} fontSize="5.5" letterSpacing="2.2">VERIFY CODE</text>
    </svg>
  );
}
