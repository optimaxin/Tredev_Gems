import React, { useState } from "react";
import { Copy, CheckCircle, CaretDown } from "@phosphor-icons/react";
import { shortCode, formatCode } from "@/lib/fingerprint";
import Seal from "@/components/gemora/Seal";

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
 * Human-friendly view of a cryptographic value: a short verification code (and, when
 * `seal` is set, a round authenticity seal showing it), with the raw hex tucked behind
 * "Show technical value". `dark` styles it for a dark background.
 */
export default function CryptoFingerprint({ value, label, description, dark = false, seal = false }) {
  const [showHex, setShowHex] = useState(false);
  if (!value) return null;
  const code = shortCode(value, 6);

  const muted = dark ? "text-ivory/60" : "text-ink-muted";
  const soft = dark ? "text-ivory/80" : "text-ink-soft";
  const line = dark ? "border-ivory/20" : "border-gold/30";
  const codeColor = dark ? "text-ivory" : "text-maroon-deep";

  return (
    <div>
      <div className={`text-[10px] uppercase tracking-widest ${muted}`}>{label}</div>
      <div className="mt-2 flex items-center gap-4">
        {seal && <Seal code={code} dark={dark} size={112} />}
        <div className="min-w-0">
          <div className={`font-serifd tracking-[0.2em] ${codeColor} ${seal ? "text-3xl" : "text-2xl"}`} data-testid="fingerprint-code">
            {formatCode(code)}
          </div>
          <div className={`mt-1 text-[10px] uppercase tracking-widest ${muted}`}>Verification code</div>
          {description && <p className={`mt-2 text-xs leading-relaxed ${soft} max-w-sm`}>{description}</p>}
        </div>
      </div>

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
