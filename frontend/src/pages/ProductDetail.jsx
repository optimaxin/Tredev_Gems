import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { api, formatINR } from "@/lib/api";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import { ShieldCheck, Certificate, QrCode, Fingerprint, Play, HandHeart, ShoppingBag, Heart, Plus, Minus } from "@phosphor-icons/react";

export default function ProductDetail() {
  const { slug } = useParams();
  const location = useLocation();
  // The product card passes its summary via router state, so we can paint the page
  // immediately instead of showing a blank "Loading…" while the detail is fetched.
  const [p, setP] = useState(() => location.state?.product ?? null);
  const [reviews, setReviews] = useState([]);
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState("trust");
  const cart = useCart();
  const nav = useNavigate();

  useEffect(() => {
    let cancelled = false;
    // Show the passed-in summary right away (stock/description fill in from the fetch).
    const pre = location.state?.product;
    if (pre && pre.slug === slug) setP(pre);
    else setP((cur) => (cur && cur.slug === slug ? cur : null)); // never flash a different product
    setQty(1);

    api.get(`/products/${slug}`).then(({ data }) => {
      if (cancelled) return;
      setP(data);
      api.get(`/reviews/${data.product_id}`).then((r) => { if (!cancelled) setReviews(r.data); }).catch(() => {});
    }).catch(() => { if (!cancelled) setP((cur) => (cur && cur.slug === slug ? cur : false)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (p === null) return <div className="p-16 text-ink-muted">Loading…</div>;
  if (!p) return <div className="p-16">Not found.</div>;

  // in_stock is a count for serialized products, null (unlimited) for non-serialized.
  const stock = p.in_stock;
  const soldOut = p.is_serialized && stock != null && stock <= 0;
  const maxQty = p.is_serialized && stock != null ? stock : 99;

  const addToCart = async () => {
    try {
      await cart.add({ product_id: p.product_id, qty });
      toast.success(`${qty} × ${p.name} added to your cart`);
      nav("/cart");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not add to cart");
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 lg:px-10 py-12">
      <div className="grid lg:grid-cols-2 gap-14">
        {/* Gallery */}
        <div>
          <div className="aspect-square gold-line-strong overflow-hidden bg-cream">
            <img src={p.images?.[0]} alt={p.name} className="w-full h-full object-cover" />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3">
            {(p.images || []).slice(0, 4).map((im, i) => (
              <div key={i} className="aspect-square gold-line overflow-hidden">
                <img src={im} className="w-full h-full object-cover" alt="" />
              </div>
            ))}
          </div>
        </div>

        {/* Info */}
        <div>
          <div className="text-xs uppercase tracking-widest text-gold-soft">{p.category?.replace("_", " ")}</div>
          {p.devanagari_name && <div className="font-deva text-2xl text-maroon-deep mt-2">{p.devanagari_name}</div>}
          <h1 className="font-display text-4xl md:text-5xl text-ink mt-2 leading-tight">{p.name}</h1>
          <div className="mt-6 flex items-baseline gap-4">
            <div className="font-display text-4xl text-maroon-deep">{formatINR(p.price)}</div>
            {p.mrp && p.mrp > p.price && <div className="text-ink-muted line-through">{formatINR(p.mrp)}</div>}
          </div>
          <p className="mt-6 text-ink-soft leading-relaxed">{p.description}</p>

          {/* Attributes */}
          {p.attrs && Object.keys(p.attrs).length > 0 && (
            <div className="mt-6 grid grid-cols-2 gap-3">
              {Object.entries(p.attrs).map(([k, v]) => (
                <div key={k} className="gold-line px-4 py-3">
                  <div className="text-[10px] uppercase tracking-widest text-ink-muted">{k}</div>
                  <div className="text-ink font-medium capitalize">{String(v)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Quantity */}
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-ink-muted">Quantity</div>
              {p.is_serialized && stock != null && (
                <div className={`text-xs ${soldOut ? "text-revoked" : "text-verified"}`}>
                  {soldOut ? "Out of stock" : `${stock} in stock`}
                </div>
              )}
            </div>
            <div className="mt-3 inline-flex items-center gold-line-strong bg-ivory">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                data-testid="qty-decrement"
                className="px-4 py-3 text-maroon disabled:opacity-30 hover:bg-cream"
                aria-label="Decrease quantity"
              >
                <Minus size={16} weight="bold" />
              </button>
              <span data-testid="qty-value" className="px-6 py-3 font-display text-xl min-w-[3.5rem] text-center tabular-nums">{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                disabled={qty >= maxQty}
                data-testid="qty-increment"
                className="px-4 py-3 text-maroon disabled:opacity-30 hover:bg-cream"
                aria-label="Increase quantity"
              >
                <Plus size={16} weight="bold" />
              </button>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={addToCart}
              data-testid="add-to-cart-btn"
              disabled={soldOut}
              className="brand-gradient text-ivory px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover-lift disabled:opacity-40"
            >
              <ShoppingBag size={16} weight="duotone" /> {soldOut ? "Sold out" : "Add to cart"}
            </button>
            <button className="border border-maroon text-maroon px-6 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover:bg-maroon hover:text-ivory transition-colors"
              onClick={() => api.post(`/me/wishlist/${p.product_id}`).then(() => toast.success("Saved to wishlist")).catch(() => toast.error("Please login to save"))}
              data-testid="wishlist-btn"
            >
              <Heart size={16} weight="duotone" /> Save
            </button>
          </div>

          {/* Trust panel */}
          <div className="mt-10 relative gold-line-strong bg-cream p-6">
            <div className="absolute inset-x-0 top-0 h-[2px] brand-gradient" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-maroon-deep">
                <ShieldCheck size={22} weight="duotone" />
                <span className="font-serifd text-xl">Trust Panel</span>
              </div>
              <span className="text-[10px] uppercase tracking-widest text-gold-soft font-mono">Cryptographic Provenance</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-ink-muted">Serial</div>
                <div className="font-mono mt-1">Assigned at dispatch</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-ink-muted">Signature</div>
                <div className="font-mono mt-1">Ed25519</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-ink-muted">Lab report</div>
                <div className="mt-1 text-ink-soft">Issued at intake</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-ink-muted">Temple energisation</div>
                <div className="mt-1 text-ink-soft">Verified pooja recording</div>
              </div>
            </div>
            <div className="mt-5 text-xs text-ink-muted">
              The QR is minted at issuance but activated only when the item is dispatched to you. This is intentional — it lets a public scan flag any label that appears in the wild before your parcel does.
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-12">
            <div className="flex gap-6 border-b border-gold/30">
              {[["trust", "The provenance chain"], ["care", "Care & wear"], ["reviews", `Reviews (${reviews.length})`]].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={`pb-3 text-sm ${tab === k ? "text-maroon-deep border-b-2 border-maroon" : "text-ink-muted"}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="mt-6 text-sm text-ink-soft leading-relaxed">
              {tab === "trust" && (
                <ul className="space-y-3">
                  <li className="flex gap-3"><Certificate size={18} className="text-gold-soft shrink-0" weight="duotone" /> Lab report from a GJEPC-affiliated laboratory attached at intake.</li>
                  <li className="flex gap-3"><HandHeart size={18} className="text-gold-soft shrink-0" weight="duotone" /> Energisation at a partner temple with a recorded pooja.</li>
                  <li className="flex gap-3"><Fingerprint size={18} className="text-gold-soft shrink-0" weight="duotone" /> Canonical JSON hashed (SHA-256) and signed with Tredev's Ed25519 key.</li>
                  <li className="flex gap-3"><QrCode size={18} className="text-gold-soft shrink-0" weight="duotone" /> Per-unit QR minted; only activated at dispatch.</li>
                </ul>
              )}
              {tab === "care" && (
                p.care_instructions?.length ? (
                  <ul className="space-y-3">
                    {p.care_instructions.map((line, i) => (
                      <li key={i} className="flex gap-3">
                        <HandHeart size={18} className="text-gold-soft shrink-0" weight="duotone" /> {line}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-muted">No care instructions added for this piece yet.</p>
                )
              )}
              {tab === "reviews" && (
                <div className="space-y-4">
                  {reviews.length === 0 && <p className="text-ink-muted">No reviews yet.</p>}
                  {reviews.map((r) => (
                    <div key={r.review_id} className="gold-line p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-ink font-medium">{r.author}</div>
                        <div className="text-gold-soft text-xs">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div>
                      </div>
                      <div className="mt-2 text-sm text-ink-soft"><strong>{r.title}</strong> {r.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
