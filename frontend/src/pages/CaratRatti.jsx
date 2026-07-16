import React, { useState } from "react";
import { Sparkle } from "@phosphor-icons/react";

export default function CaratRatti() {
  const [carat, setCarat] = useState("");
  const [ratti, setRatti] = useState("");
  const CR = 0.9114; // 1 ratti ≈ 0.9114 ct

  const onCarat = (v) => {
    setCarat(v);
    setRatti(v === "" ? "" : (parseFloat(v) / CR).toFixed(3));
  };
  const onRatti = (v) => {
    setRatti(v);
    setCarat(v === "" ? "" : (parseFloat(v) * CR).toFixed(3));
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Free tool</div>
      <h1 className="font-display text-4xl text-ink mt-3">Carat ↔ Ratti Converter</h1>
      <p className="mt-3 text-ink-soft">Traditional Indian gemstone weights use ratti; labs report in carat. This tool converts both ways using the standard 1 ratti ≈ 0.9114 ct.</p>
      <div className="mt-10 grid md:grid-cols-2 gap-6">
        <div className="gold-line bg-ivory p-6">
          <div className="text-xs uppercase tracking-widest text-ink-muted mb-2">Carat</div>
          <input value={carat} type="number" step="0.001" onChange={(e) => onCarat(e.target.value)} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon font-mono text-xl" />
        </div>
        <div className="gold-line bg-ivory p-6">
          <div className="text-xs uppercase tracking-widest text-ink-muted mb-2">Ratti</div>
          <input value={ratti} type="number" step="0.001" onChange={(e) => onRatti(e.target.value)} className="w-full gold-line px-4 py-3 outline-none focus:border-maroon font-mono text-xl" />
        </div>
      </div>
      <div className="mt-8 gold-line p-5 bg-cream text-sm text-ink-soft flex items-start gap-2">
        <Sparkle size={16} weight="duotone" className="text-gold-soft shrink-0 mt-0.5" />
        <span>Note: Some traditions use 1 ratti = 0.91 ct (approximate). Tredev uses the ICA-aligned 0.9114 ct.</span>
      </div>
    </div>
  );
}
