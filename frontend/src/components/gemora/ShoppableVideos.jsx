import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, mediaSrc } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { toast } from "sonner";
import { CaretLeft, CaretRight, ShoppingBagOpen } from "@phosphor-icons/react";
import { useCart } from "@/context/CartContext";

// One portrait video, autoplaying (muted — the only way browsers allow autoplay
// without a user gesture) and looping, with the linked product pinned at the
// bottom: photo, price, and a one-tap add — no need to open the product page
// unless the buyer wants to change options.
function VideoCard({ v }) {
  const p = v.product;
  const cart = useCart();
  const [adding, setAdding] = useState(false);
  const off = p.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;

  const addToBag = async (e) => {
    e.preventDefault();
    setAdding(true);
    try {
      await cart.add({ product_id: p.product_id, qty: 1 });
      toast.success(`${p.name} added to your cart`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not add to cart");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="relative shrink-0 w-[240px] sm:w-[260px] aspect-[9/16] snap-start overflow-hidden gold-line-strong bg-ink">
      <video
        src={v.video_url}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-maroon-deep/95 via-maroon-deep/70 to-transparent pt-10 pb-3 px-3">
        <Link to={`/product/${p.slug}`} className="flex items-center gap-2">
          <div className="w-9 h-9 shrink-0 overflow-hidden gold-line bg-ivory">
            <img src={mediaSrc(p.images?.[0])} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-ivory text-xs truncate">{p.name}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-sm text-ivory">{formatPrice(p.price, p.currency)}</span>
              {off > 0 && <span className="text-[10px] text-ivory/60 line-through">{formatPrice(p.mrp, p.currency)}</span>}
              {off > 0 && <span className="text-[9px] bg-maroon text-ivory px-1 py-0.5 font-mono">-{off}%</span>}
            </div>
          </div>
        </Link>
        <button
          onClick={addToBag}
          disabled={adding}
          data-testid={`shoppable-video-add-${p.product_id}`}
          className="mt-2 w-full brand-gradient text-ivory text-[11px] uppercase tracking-widest py-2 inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <ShoppingBagOpen size={12} weight="duotone" /> {adding ? "Adding…" : "Add to bag"}
        </button>
      </div>
    </div>
  );
}

export default function ShoppableVideos() {
  const [data, setData] = useState(null);
  const scrollerRef = useRef(null);

  useEffect(() => {
    api.get("/shoppable-videos").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  const scrollBy = (dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: "smooth" });
  };

  if (!data?.videos?.length) return null;

  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20" aria-label="Shoppable videos">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="font-display text-4xl md:text-5xl text-ink">{data.title}</h2>
          {data.subtitle && <p className="text-ink-soft mt-2">{data.subtitle}</p>}
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <button onClick={() => scrollBy(-1)} aria-label="Previous" className="w-10 h-10 rounded-full border border-gold/40 text-ink-soft hover:text-maroon hover:border-maroon flex items-center justify-center">
            <CaretLeft size={16} />
          </button>
          <button onClick={() => scrollBy(1)} aria-label="Next" className="w-10 h-10 rounded-full border border-gold/40 text-ink-soft hover:text-maroon hover:border-maroon flex items-center justify-center">
            <CaretRight size={16} />
          </button>
        </div>
      </div>
      <div ref={scrollerRef} className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 -mx-6 px-6 lg:-mx-10 lg:px-10">
        {data.videos.map((v, i) => <VideoCard key={i} v={v} />)}
      </div>
    </section>
  );
}
