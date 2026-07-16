import React from "react";

export function Flourish({ className = "" }) {
  return (
    <svg viewBox="0 0 120 12" className={className} aria-hidden="true">
      <path d="M2 6 h30 M88 6 h30" stroke="currentColor" strokeWidth="1" fill="none" />
      <circle cx="60" cy="6" r="3" fill="currentColor" opacity="0.4" />
      <circle cx="60" cy="6" r="1.2" fill="currentColor" />
      <path d="M40 6 q10 -6 20 0 q10 6 20 0" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

export function OrnamentHeader({ eyebrow, title, className = "" }) {
  return (
    <div className={`text-center ${className}`}>
      {eyebrow && <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">{eyebrow}</div>}
      <div className="mt-3 flex items-center justify-center gap-4 text-gold-soft">
        <Flourish className="w-24 h-2 opacity-70" />
        <h2 className="font-display text-4xl md:text-5xl text-ink whitespace-nowrap">{title}</h2>
        <Flourish className="w-24 h-2 opacity-70 -scale-x-100" />
      </div>
    </div>
  );
}
