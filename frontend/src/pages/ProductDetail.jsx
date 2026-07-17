import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { api, formatINR } from "@/lib/api";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import { ShieldCheck, Certificate, ShoppingBag, Heart, Plus, Minus, CaretLeft, CaretRight, Star, Truck, ArrowsClockwise, FlowerLotus, Lightning } from "@phosphor-icons/react";
import ProductStory from "@/components/gemora/ProductStory";
import { CATEGORY_LABEL } from "@/lib/productCopy";

export default function ProductDetail() {
  const { slug } = useParams();
  const location = useLocation();
  // The product card passes its summary via router state, so we can paint the page
  // immediately instead of showing a blank "Loading…" while the detail is fetched.
  const [p, setP] = useState(() => location.state?.product ?? null);
  const [reviews, setReviews] = useState([]);
  const [qty, setQty] = useState(1);
  const [active, setActive] = useState(0); // selected gallery image
  // {group_key: choice_label} — which option the buyer picked in each selector.
  const [picked, setPicked] = useState({});
  const cart = useCart();
  const nav = useNavigate();

  useEffect(() => {
    let cancelled = false;
    // Show the passed-in summary right away (stock/description fill in from the fetch).
    const pre = location.state?.product;
    if (pre && pre.slug === slug) setP(pre);
    else setP((cur) => (cur && cur.slug === slug ? cur : null)); // never flash a different product
    setQty(1);
    setActive(0); // reset gallery to the first photo for the new product
    setPicked({});

    api.get(`/products/${slug}`).then(({ data }) => {
      if (cancelled) return;
      setP(data);
      // Which selectors exist is category-driven, so defaults can only be set once the
      // product is loaded: each group starts on its first (free) choice. Optional
      // groups are deliberately left unset — Ring Size System must open on "Select Ring
      // System", not silently preselect Indian and skip the "I don't know" path.
      const groups = data.variant_options?.groups || [];
      setPicked(Object.fromEntries(
        groups.filter((g) => !g.optional).map((g) => [g.key, g.choices[0]?.label])));
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

  // Option groups come from the product's category (rudraksha gets certification/
  // style/size, gemstone gets pooja/form/metal/designs/ring-size, everything gets
  // Mantra Jaap...). Mirrors the backend's _visible_groups: a group with show_if only
  // renders once its controlling group holds a matching value, so Metal/Designs/Size
  // appear only after Ring or Pendant is chosen. Same additive surcharge math too, so
  // the displayed price never lags the real one.
  const allGroups = p.variant_options?.groups || [];
  const visible = [];
  const resolved = {}; // group key -> effective value, for evaluating later show_ifs
  for (const g of allGroups) {
    const si = g.show_if;
    if (si && !(si.values || []).includes(resolved[si.group])) continue;
    // Designs are stored one row per metal, so narrow the grid to the chosen metal —
    // the same code (R14) exists in several metals at different prices.
    const choices = (g.choices || []).filter((c) => !c.metal || c.metal === resolved.metal);
    if (!choices.length) continue;
    visible.push({ ...g, choices });
    const pick = picked[g.key];
    if (pick != null && choices.some((c) => c.label === pick)) resolved[g.key] = pick;
    else if (!g.optional) resolved[g.key] = choices[0].label;
  }

  const unitPrice = visible.reduce((sum, g) => {
    const c = g.choices.find((x) => x.label === resolved[g.key]);
    return sum + (c?.surcharge || 0);
  }, p.price);

  // Send only what's actually visible — a stale pick from a hidden group (e.g. a
  // ring size after switching back to Loose Gemstone) must not reach the cart.
  const put = async () => {
    const options = {};
    for (const g of visible) if (resolved[g.key] != null) options[g.key] = resolved[g.key];
    await cart.add({ product_id: p.product_id, qty, options });
  };

  const addToCart = async () => {
    try {
      await put();
      toast.success(`${qty} × ${p.name} added to your cart`);
      nav("/cart");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not add to cart");
    }
  };

  const buyNow = async () => {
    try {
      await put();
      nav("/checkout");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not add to cart");
    }
  };

  const rating = reviews.length
    ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length
    : 0;
  const off = p.mrp && p.mrp > unitPrice ? Math.round(((p.mrp - unitPrice) / p.mrp) * 100) : 0;

  return (
    <div className="pb-24 lg:pb-0">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mx-auto max-w-7xl px-6 lg:px-10 pt-8">
        <ol className="flex items-center gap-2 text-xs text-ink-muted flex-wrap">
          <li><Link to="/" className="hover:text-maroon">Home</Link></li>
          <li aria-hidden="true"><CaretRight size={10} /></li>
          <li>
            <Link to={`/shop?category=${p.category}`} className="hover:text-maroon">
              {CATEGORY_LABEL[p.category] || p.category?.replace(/_/g, " ")}
            </Link>
          </li>
          <li aria-hidden="true"><CaretRight size={10} /></li>
          <li className="text-ink-soft truncate max-w-[50vw]" aria-current="page">{p.name}</li>
        </ol>
      </nav>

      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-10">
      <div className="grid lg:grid-cols-2 gap-14">
        {/* Gallery */}
        <div className="lg:sticky lg:top-24 h-fit">
          {(() => {
            const images = (p.images || []).filter(Boolean);
            const idx = Math.min(active, Math.max(0, images.length - 1));
            const go = (d) => setActive((images.length + idx + d) % images.length);
            return (
              <>
                <div className="relative aspect-square gold-line-strong overflow-hidden bg-cream group">
                  {images.length > 0 ? (
                    <img
                      key={idx}
                      src={images[idx]}
                      alt={`${p.name} — photo ${idx + 1}`}
                      data-testid="product-main-image"
                      className="w-full h-full object-cover img-hover fade-up"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink-muted">No image</div>
                  )}

                  {images.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => go(-1)}
                        aria-label="Previous photo"
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-ivory/85 backdrop-blur border border-gold/40 text-maroon-deep flex items-center justify-center hover:bg-ivory transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        <CaretLeft size={18} weight="bold" />
                      </button>
                      <button
                        type="button"
                        onClick={() => go(1)}
                        aria-label="Next photo"
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-ivory/85 backdrop-blur border border-gold/40 text-maroon-deep flex items-center justify-center hover:bg-ivory transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        <CaretRight size={18} weight="bold" />
                      </button>
                      <div className="absolute bottom-3 right-3 bg-maroon-deep/80 text-ivory text-[11px] font-mono px-2 py-1 tracking-widest">
                        {idx + 1} / {images.length}
                      </div>
                    </>
                  )}
                </div>

                {images.length > 1 && (
                  <div className="mt-3 grid grid-cols-5 gap-3">
                    {images.map((im, i) => (
                      <button
                        type="button"
                        key={i}
                        onClick={() => setActive(i)}
                        aria-label={`View photo ${i + 1}`}
                        aria-current={i === idx}
                        data-testid={`product-thumb-${i}`}
                        className={`aspect-square overflow-hidden transition-all ${
                          i === idx
                            ? "gold-line-strong ring-2 ring-maroon ring-offset-2 ring-offset-ivory"
                            : "gold-line opacity-60 hover:opacity-100"
                        }`}
                      >
                        <img src={im} className="w-full h-full object-cover" alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Info */}
        <div>
          <div className="text-xs uppercase tracking-widest text-gold-soft">{p.category?.replace("_", " ")}</div>
          {p.devanagari_name && <div className="font-deva text-2xl text-maroon-deep mt-2">{p.devanagari_name}</div>}
          <h1 className="font-display text-4xl md:text-5xl text-ink mt-2 leading-tight">{p.name}</h1>

          {/* rating summary */}
          {reviews.length > 0 && (
            <a href="#reviews" className="mt-3 inline-flex items-center gap-2 group">
              <span className="flex gap-0.5 text-gold">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={14} weight={i < Math.round(rating) ? "fill" : "regular"} />
                ))}
              </span>
              <span className="font-mono text-xs text-ink-soft">{rating.toFixed(1)}</span>
              <span className="text-xs text-ink-muted group-hover:text-maroon underline underline-offset-4 decoration-gold-soft">
                {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
              </span>
            </a>
          )}

          <div className="mt-6 flex items-baseline gap-4 flex-wrap">
            <div className="font-display text-4xl text-maroon-deep" data-testid="product-unit-price">{formatINR(unitPrice)}</div>
            {p.mrp && p.mrp > unitPrice && <div className="text-ink-muted line-through">{formatINR(p.mrp)}</div>}
            {off > 0 && (
              <span className="bg-maroon text-ivory text-[11px] font-mono px-2 py-1 tracking-widest">{off}% OFF</span>
            )}
          </div>
          {unitPrice !== p.price && (
            <div className="text-xs text-ink-muted mt-1">Base price {formatINR(p.price)} + your selected options</div>
          )}
          <p className="mt-6 text-ink-soft leading-relaxed">{p.description}</p>

          {/* Quick trust chips — the full detail lives further down the page */}
          <div className="mt-6 flex flex-wrap gap-2">
            {[
              [Truck, "Free shipping"],
              [ArrowsClockwise, "7-day returns"],
              [Certificate, "Lab-certified"],
              [FlowerLotus, "Temple energised"],
            ].map(([I, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5 gold-line bg-cream px-3 py-1.5 text-[11px] uppercase tracking-widest text-ink-soft">
                <I size={13} weight="duotone" className="text-gold-soft" /> {label}
              </span>
            ))}
          </div>

          {/* Option groups — which ones appear is driven by the product's category.
              Price updates live as these change. Pre-made categories (jewellery,
              malas, yantras) only carry Mantra Jaap; some carry nothing at all. */}
          {visible.length > 0 && (
            <div className="mt-8 space-y-5">
              {visible.map((g) => (
                <div key={g.key} data-testid={`option-group-${g.key}`}>
                  <div className="text-xs uppercase tracking-widest text-ink-muted mb-2">
                    {g.label}{g.key === "form" && resolved.form ? `: ${resolved.form}` : ""}
                  </div>
                  {g.type === "images" ? (
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 max-h-[26rem] overflow-y-auto pr-1">
                      {g.choices.map((c) => {
                        const on = resolved[g.key] === c.label;
                        return (
                          <button
                            key={c.label}
                            type="button"
                            onClick={() => setPicked((s) => ({ ...s, [g.key]: c.label }))}
                            aria-pressed={on}
                            data-testid={`option-${g.key}-${c.label}`}
                            className={`text-center border p-1.5 transition-colors ${
                              on ? "border-maroon bg-cream" : "border-gold/30 hover:border-maroon"
                            }`}
                          >
                            <div className="aspect-square overflow-hidden bg-ivory">
                              {c.image
                                ? <img src={c.image} alt={c.label} loading="lazy" className="w-full h-full object-contain" />
                                : <div className="w-full h-full flex items-center justify-center text-[10px] text-ink-muted">No image</div>}
                            </div>
                            <div className="mt-1 text-[11px] leading-tight">
                              <div className="font-medium">{c.label}</div>
                              {c.note && <div className="text-ink-muted">{c.note}</div>}
                              {c.surcharge > 0 && (
                                <div className="text-maroon-deep">+{formatINR(c.surcharge)}</div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : g.type === "buttons" ? (
                    <div className="flex flex-wrap gap-2">
                      {g.choices.map((c) => {
                        const on = resolved[g.key] === c.label;
                        return (
                          <button
                            key={c.label}
                            type="button"
                            onClick={() => setPicked((s) => ({ ...s, [g.key]: c.label }))}
                            aria-pressed={on}
                            data-testid={`option-${g.key}-${c.label}`}
                            className={`px-4 py-2.5 border text-sm transition-colors ${
                              on ? "border-maroon bg-cream text-maroon-deep" : "border-gold/40 text-ink-soft hover:border-maroon"
                            }`}
                          >
                            {c.label}
                            {c.surcharge > 0 && <span className="text-xs text-ink-muted"> +{formatINR(c.surcharge)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <select
                      value={resolved[g.key] ?? ""}
                      onChange={(e) => setPicked((s) => ({ ...s, [g.key]: e.target.value }))}
                      data-testid={`option-${g.key}`}
                      className="w-full sm:max-w-md gold-line px-3 py-2.5 bg-ivory outline-none focus:border-maroon"
                    >
                      {/* Optional groups start unselected — e.g. "Select Ring System" */}
                      {g.optional && <option value="">Select {g.label.replace(/^Select /, "")}</option>}
                      {g.choices.map((c) => (
                        <option key={c.label} value={c.label}>
                          {c.label}{c.surcharge > 0 ? ` (+${formatINR(c.surcharge)})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* The escape hatch: staff will call to get the size. */}
                  {g.key === "ring_size_system" && resolved.ring_size_system === "I don't know" && (
                    <div className="mt-2 text-xs text-ink-soft gold-line bg-cream px-3 py-2">
                      No problem — we'll contact you to confirm your ring size before we make it.
                    </div>
                  )}
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
            <button
              onClick={buyNow}
              data-testid="buy-now-btn"
              disabled={soldOut}
              className="border border-maroon bg-maroon text-ivory px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover:bg-maroon-deep transition-colors disabled:opacity-40"
            >
              <Lightning size={16} weight="fill" /> Buy it now
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

        </div>
      </div>
      </div>

      {/* ── The immersive story: specs, benefits, provenance, ritual, care,
             reviews, consultation, policies, FAQ and related pieces. Every
             section is data-driven, so it works for all categories. ── */}
      <ProductStory p={p} reviews={reviews} />

      {/* Sticky buy bar — mobile only */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 sticky-rise bg-ivory/95 backdrop-blur border-t border-gold/40">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="min-w-0">
            <div className="font-display text-xl text-maroon-deep leading-none">{formatINR(unitPrice)}</div>
            {off > 0 && <div className="text-[10px] text-ink-muted line-through">{formatINR(p.mrp)}</div>}
          </div>
          <button
            onClick={addToCart}
            disabled={soldOut}
            data-testid="sticky-add-to-cart"
            className="ml-auto brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-40"
          >
            <ShoppingBag size={14} weight="duotone" /> {soldOut ? "Sold out" : "Add to cart"}
          </button>
          <button
            onClick={buyNow}
            disabled={soldOut}
            className="bg-maroon text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-40"
          >
            <Lightning size={14} weight="fill" /> Buy
          </button>
        </div>
      </div>
    </div>
  );
}
