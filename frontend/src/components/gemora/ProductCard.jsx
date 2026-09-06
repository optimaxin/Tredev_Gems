import React from "react";
import { Link } from "react-router-dom";
import { api, mediaSrc } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { ShieldCheck, Star, CreditCard } from "@phosphor-icons/react";

export default function ProductCard({ p }) {
  const off = p.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
  const reviewCount = p.review_count || 0;
  const filledStars = Math.round(p.rating || 0);
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
          src={mediaSrc(p.images?.[0])}
          alt={p.name}
          className="w-full h-full object-cover img-hover"
          loading="lazy"
        />
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-ivory/90 backdrop-blur px-1.5 py-1 sm:px-2 text-[10px] tracking-widest uppercase text-verified border border-gold/40 flex items-center gap-1">
          <ShieldCheck size={12} weight="duotone" /> <span className="hidden sm:inline">Certified</span>
        </div>
        {off > 0 && (
          <div className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-maroon text-ivory text-[9px] sm:text-[10px] px-1.5 py-1 sm:px-2 font-mono">
            {off}% OFF
          </div>
        )}
      </div>
      <div className="p-3 sm:p-5 flex-1 flex flex-col">
        {p.devanagari_name && (
          <div className="font-deva text-xs sm:text-sm text-gold-soft truncate">{p.devanagari_name}</div>
        )}
        <h3 className="font-serifd text-base sm:text-xl text-ink mt-1 leading-snug line-clamp-2 min-h-[2.5em] sm:min-h-[2.6em]">{p.name}</h3>
        <div className="text-[10px] sm:text-xs text-ink-muted mt-1 uppercase tracking-widest truncate">{p.category}</div>
        <div className="mt-2 flex items-center gap-1 text-xs text-gold-soft">
          {Array.from({ length: 5 }).map((_, k) => (
            <Star key={k} size={11} weight={k < filledStars ? "fill" : "regular"} />
          ))}
          <span className="text-ink-muted ml-1">{reviewCount > 0 ? `${p.rating.toFixed(1)} (${reviewCount})` : "New"}</span>
        </div>
        <div className="mt-auto pt-3 sm:pt-5 flex flex-col gap-0.5 min-h-[2.4rem] sm:min-h-[3.2rem]">
          <span className="font-display text-lg sm:text-2xl text-maroon-deep">{formatPrice(p.price, p.currency)}</span>
          {p.mrp && p.mrp > p.price && (
            <span className="text-xs sm:text-sm text-ink-muted line-through">{formatPrice(p.mrp, p.currency)}</span>
          )}
        </div>
        <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono text-verified uppercase tracking-widest">
          <CreditCard size={13} weight="duotone" className="shrink-0" /> <span className="truncate">Prepaid 5% off</span>
        </div>
      </div>
    </Link>
  );
}
