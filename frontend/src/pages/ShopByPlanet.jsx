import React from "react";
import { Link } from "react-router-dom";

const PLANETS = [
  { key: "Sun", devanagari: "सूर्य", stone: "Ruby", tag: "Confidence & leadership" },
  { key: "Moon", devanagari: "चंद्र", stone: "Pearl", tag: "Peace of mind" },
  { key: "Mars", devanagari: "मंगल", stone: "Red Coral", tag: "Courage" },
  { key: "Mercury", devanagari: "बुध", stone: "Emerald", tag: "Communication" },
  { key: "Jupiter", devanagari: "गुरु", stone: "Yellow Sapphire", tag: "Wisdom & wealth" },
  { key: "Venus", devanagari: "शुक्र", stone: "Diamond", tag: "Love & harmony" },
  { key: "Saturn", devanagari: "शनि", stone: "Blue Sapphire", tag: "Discipline & career" },
  { key: "Rahu", devanagari: "राहु", stone: "Hessonite", tag: "Overcoming shadows" },
  { key: "Ketu", devanagari: "केतु", stone: "Cat's Eye", tag: "Detachment" },
];

export default function ShopByPlanet() {
  return (
    <div className="mx-auto max-w-7xl px-6 lg:px-10 py-14">
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">The Nine Planets · नवग्रह</div>
      <h1 className="font-display text-4xl md:text-5xl text-ink mt-3">Shop by Planet</h1>
      <p className="mt-4 max-w-2xl text-ink-soft">Every graha has a signature stone. Choose your ruler.</p>
      <div className="mt-12 grid md:grid-cols-3 gap-5">
        {PLANETS.map((p, i) => (
          <Link
            key={p.key}
            to={`/shop?graha=${encodeURIComponent(p.key)}`}
            className="group gold-line bg-ivory p-8 hover-lift relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-[2px] brand-gradient opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="font-mono text-[10px] tracking-widest text-gold-soft">GRAHA · 0{i + 1}</div>
            <div className="mt-2 font-display text-4xl text-maroon-deep">{p.key}</div>
            <div className="font-deva text-2xl text-gold-soft mt-1">{p.devanagari}</div>
            <div className="mt-5 text-sm text-ink-soft">Signature stone: <strong>{p.stone}</strong></div>
            <div className="text-xs text-ink-muted mt-1">{p.tag}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
