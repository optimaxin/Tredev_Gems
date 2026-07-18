import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import ProductCard from "@/components/gemora/ProductCard";
import CategoryBanner from "@/components/gemora/CategoryBanner";
import { Funnel } from "@phosphor-icons/react";

const CATS = ["gemstone", "rudraksha", "bracelet", "yantra", "idol", "pooja_kit", "prashad", "book"];
const PLANETS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"];
const PURPOSES = ["wealth", "protection", "love", "career", "health"];

export default function Shop() {
  const [sp, setSp] = useSearchParams();
  const category = sp.get("category") || "";
  const graha = sp.get("graha") || "";
  const purpose = sp.get("purpose") || "";
  const q = sp.get("q") || "";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (category) p.set("category", category);
    if (graha) p.set("graha", graha);
    if (purpose) p.set("purpose", purpose);
    if (q) p.set("q", q);
    return p.toString();
  }, [category, graha, purpose, q]);

  useEffect(() => {
    setLoading(true);
    api.get(`/products?${params}`).then(({ data }) => setItems(data)).finally(() => setLoading(false));
  }, [params]);

  const setFilter = (k, v) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n);
  };

  // A single-category view gets the full editorial collection banner; search and
  // the all-goods view keep the plain header.
  const showBanner = category && !q;

  return (
    <div>
      {/* Full-bleed hero collection banner (single-category view) */}
      {showBanner && <CategoryBanner category={category} />}

      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-12">
      {!showBanner && (
        <header className="mb-10">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">The Store · भंडार</div>
          <h1 className="font-display text-4xl md:text-5xl text-ink mt-3">
            {q ? <>Search — <em className="font-serifd">"{q}"</em></> : "All authentic goods"}
          </h1>
        </header>
      )}

      <div id="collection-grid" className="grid lg:grid-cols-[320px_1fr] gap-10 scroll-mt-24">
        <aside className="lg:sticky lg:top-24 h-fit">
          <div className="gold-line-strong p-6">
            <div className="flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-ink pb-4 border-b border-gold/20"><Funnel size={18} weight="duotone" className="text-gold-soft" /> Filters</div>
            <div className="mt-6">
              <div className="text-[11px] uppercase tracking-[0.2em] text-ink-muted mb-3">Category</div>
              <div className="flex flex-wrap gap-2.5">
                {CATS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setFilter("category", category === c ? "" : c)}
                    data-testid={`filter-cat-${c}`}
                    className={`text-sm px-3.5 py-2 border transition-colors ${category === c ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft hover:border-maroon"}`}
                  >
                    {c.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-7">
              <div className="text-[11px] uppercase tracking-[0.2em] text-ink-muted mb-3">Planet</div>
              <div className="flex flex-wrap gap-2.5">
                {PLANETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setFilter("graha", graha === p ? "" : p)}
                    className={`text-sm px-3.5 py-2 border transition-colors ${graha === p ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft hover:border-maroon"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-7">
              <div className="text-[11px] uppercase tracking-[0.2em] text-ink-muted mb-3">Purpose</div>
              <div className="flex flex-wrap gap-2.5">
                {PURPOSES.map((p) => (
                  <button
                    key={p}
                    onClick={() => setFilter("purpose", purpose === p ? "" : p)}
                    className={`text-sm px-3.5 py-2 border capitalize transition-colors ${purpose === p ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft hover:border-maroon"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <div>
          {loading ? (
            <div className="text-ink-muted">Loading…</div>
          ) : items.length === 0 ? (
            <div className="gold-line p-10 text-center text-ink-muted">No goods match those filters. Try widening.</div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
              {items.map((p) => <ProductCard key={p.product_id} p={p} />)}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
