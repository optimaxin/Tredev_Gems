import React from "react";
import { Link } from "react-router-dom";
import { api, formatINR } from "@/lib/api";
import { ShieldCheck, Star, CreditCard } from "@phosphor-icons/react";

export default function ProductCard({ p }) {
  const off = p.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
  // Warm the detail request (and the shared GET cache) on hover so the click opens
  // instantly with units already loaded, rather than waiting on a fresh round-trip.
  const prefetch = () => { api.get(`/products/${p.slug}`).catch(() => {}); };
  return (
    <Link
      to={`/product/${p.slug}`}
      state={{ product: p }}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      data-testid={`product-card-${p.slug}`}
      className="group card-sharp p-0 overflow-hidden hover-lift bg-ivory flex flex-col relative"
    >
      <div className="aspect-[4/5] overflow-hidden bg-cream relative">
        <img
          src={p.images?.[0]}
          alt={p.name}
          className="w-full h-full object-cover img-hover"
          loading="lazy"
        />
        <div className="absolute top-3 left-3 bg-ivory/90 backdrop-blur px-2 py-1 text-[10px] tracking-widest uppercase text-verified border border-gold/40 flex items-center gap-1">
          <ShieldCheck size={12} weight="duotone" /> Certified
        </div>
        {off > 0 && (
          <div className="absolute top-3 right-3 bg-maroon text-ivory text-[10px] px-2 py-1 font-mono">
            {off}% OFF
          </div>
        )}
      </div>
      <div className="p-5 flex-1 flex flex-col">
        {p.devanagari_name && (
          <div className="font-deva text-sm text-gold-soft">{p.devanagari_name}</div>
        )}
        <h3 className="font-serifd text-xl text-ink mt-1 leading-snug">{p.name}</h3>
        <div className="text-xs text-ink-muted mt-1 uppercase tracking-widest">{p.category}</div>
        <div className="mt-2 flex items-center gap-1 text-xs text-gold-soft">
          {Array.from({ length: 5 }).map((_, k) => <Star key={k} size={11} weight="fill" />)}
          <span className="text-ink-muted ml-1">(4.9)</span>
        </div>
        <div className="mt-auto pt-5 flex items-baseline gap-3">
          <span className="font-display text-2xl text-maroon-deep">{formatINR(p.price)}</span>
          {p.mrp && p.mrp > p.price && (
            <span className="text-sm text-ink-muted line-through">{formatINR(p.mrp)}</span>
          )}
        </div>
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-mono text-verified uppercase tracking-widest">
          <CreditCard size={13} weight="duotone" /> Prepaid 5% off
        </div>
      </div>
    </Link>
  );
}
