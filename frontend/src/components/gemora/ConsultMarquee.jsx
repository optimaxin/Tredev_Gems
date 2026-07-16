import React from "react";
import { Link } from "react-router-dom";
import { Sparkle } from "@phosphor-icons/react";

export default function ConsultMarquee() {
  const items = new Array(6).fill(null);
  return (
    <div className="brand-gradient text-ivory overflow-hidden">
      <div className="flex whitespace-nowrap py-2.5 marquee-track">
        {items.concat(items).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-8 text-sm tracking-wider">
            <Sparkle size={14} weight="fill" />
            <span>Book your consultation @ <b>₹499</b> <span className="line-through opacity-70">₹699</span></span>
            <span>·</span>
            <Link to="/consultation" className="underline underline-offset-4">Reserve yours now →</Link>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .marquee-track { animation: marquee 30s linear infinite; }
      `}</style>
    </div>
  );
}
