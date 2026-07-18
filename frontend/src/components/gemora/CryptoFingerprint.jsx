import React, { useState } from "react";
import { Copy, CheckCircle, CaretDown } from "@phosphor-icons/react";
import { identicon, emojiFingerprint, wordFingerprint } from "@/lib/fingerprint";

// A small 5×5 identicon rendered from the value.
function Identicon({ value, size = 56, className = "" }) {
  const { cells, color } = identicon(value);
  const n = cells.length || 5;
  const cell = size / n;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden="true">
      <rect width={size} height={size} rx="6" fill={color} opacity="0.08" />
      {cells.map((row, r) =>
        row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell} rx={cell * 0.18} fill={color} /> : null
        )
      )}
    </svg>
  );
}

function CopyMini({ text, dark }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className={`inline-flex items-center gap-1 text-[11px] ${dark ? "text-ivory/70 hover:text-ivory" : "text-ink-muted hover:text-maroon"}`}
    >
      {done ? <CheckCircle size={12} weight="duotone" className="text-verified" /> : <Copy size={12} />} {done ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Human-friendly view of a cryptographic value. Shows a recognisable picture + emoji +
 * word phrase (understand & remember) with the raw hex tucked behind "Show technical
 * value" (for the technically inclined). `dark` styles it for a dark background.
 */
export default function CryptoFingerprint({ value, label, description, dark = false }) {
  const [showHex, setShowHex] = useState(false);
  if (!value) return null;
  const emoji = emojiFingerprint(value, 5);
  const words = wordFingerprint(value, 4);

  const muted = dark ? "text-ivory/60" : "text-ink-muted";
  const soft = dark ? "text-ivory/80" : "text-ink-soft";
  const line = dark ? "border-ivory/20" : "border-gold/30";

  return (
    <div>
      <div className={`text-[10px] uppercase tracking-widest ${muted}`}>{label}</div>
      <div className="mt-2 flex items-center gap-3">
        <Identicon value={value} className={`shrink-0 border ${line} rounded-md`} />
        <div className="min-w-0">
          <div className="text-2xl leading-none tracking-wide" aria-hidden="true">{emoji.join(" ")}</div>
          <div className={`mt-1.5 text-sm font-serifd capitalize ${dark ? "text-ivory" : "text-maroon-deep"}`}>
            {words.join(" · ")}
          </div>
        </div>
      </div>
      {description && <p className={`mt-2 text-xs leading-relaxed ${soft}`}>{description}</p>}

      <button
        type="button"
        onClick={() => setShowHex((s) => !s)}
        className={`mt-2 inline-flex items-center gap-1 text-[11px] ${muted} ${dark ? "hover:text-ivory" : "hover:text-maroon"}`}
      >
        <CaretDown size={11} weight="bold" className={`transition-transform ${showHex ? "rotate-180" : ""}`} />
        {showHex ? "Hide technical value" : "Show technical value"}
      </button>
      {showHex && (
        <div className={`mt-2 border-t ${line} pt-2`}>
          <div className="font-mono text-[11px] break-all leading-relaxed">{value}</div>
          <div className="mt-1"><CopyMini text={value} dark={dark} /></div>
        </div>
      )}
    </div>
  );
}
