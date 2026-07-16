import React from "react";
import { Link } from "react-router-dom";
import { CurrencyInr, Shield, HeartStraight, Briefcase, FirstAid } from "@phosphor-icons/react";

const PURPOSES = [
  { key: "wealth", label: "Wealth", devanagari: "धन", Icon: CurrencyInr, tag: "Prosperity & abundance", img: "https://images.pexels.com/photos/9953656/pexels-photo-9953656.jpeg" },
  { key: "protection", label: "Protection", devanagari: "रक्षा", Icon: Shield, tag: "Against negative energy", img: "https://images.unsplash.com/photo-1609619385076-36a873425636?w=1200" },
  { key: "love", label: "Love", devanagari: "प्रेम", Icon: HeartStraight, tag: "Harmony & relationships", img: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=1200" },
  { key: "career", label: "Career", devanagari: "करियर", Icon: Briefcase, tag: "Focus & advancement", img: "https://images.unsplash.com/photo-1544376664-80b17f09d399?w=1200" },
  { key: "health", label: "Health", devanagari: "स्वास्थ्य", Icon: FirstAid, tag: "Vitality & healing", img: "https://images.unsplash.com/photo-1661915606983-cc9759b99343?w=1200" },
];

export default function ShopByPurpose() {
  return (
    <div className="mx-auto max-w-7xl px-6 lg:px-10 py-14">
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">The five intents</div>
      <h1 className="font-display text-4xl md:text-5xl text-ink mt-3">Shop by Purpose</h1>
      <p className="mt-4 max-w-2xl text-ink-soft">Let the stone find you. Filter by intent.</p>
      <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {PURPOSES.map((p) => (
          <Link key={p.key} to={`/shop?purpose=${p.key}`} className="relative overflow-hidden gold-line hover-lift aspect-[4/5]">
            <img src={p.img} alt={p.label} className="w-full h-full object-cover img-hover" />
            <div className="absolute inset-0 bg-gradient-to-t from-maroon-deep/85 via-maroon-deep/20 to-transparent" />
            <div className="absolute bottom-6 left-6 right-6">
              <p.Icon size={24} weight="duotone" className="text-gold" />
              <div className="font-deva text-gold-soft text-lg mt-2">{p.devanagari}</div>
              <div className="font-display text-3xl text-ivory mt-1">{p.label}</div>
              <div className="text-sm text-ivory/80 mt-1">{p.tag}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
