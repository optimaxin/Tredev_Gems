import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { api, formatINR } from "@/lib/api";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import { ShieldCheck, Certificate, QrCode, Fingerprint, Play, HandHeart, ShoppingBag, Heart, Plus, Minus, CaretLeft, CaretRight } from "@phosphor-icons/react";

export default function ProductDetail() {
  const { slug } = useParams();
  const location = useLocation();
  // The product card passes its summary via router state, so we can paint the page
  // immediately instead of showing a blank "Loading…" while the detail is fetched.
  const [p, setP] = useState(() => location.state?.product ?? null);
  const [reviews, setReviews] = useState([]);
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState("trust");
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
      // product is loaded: every group starts on its first (free) choice.
      const groups = data.variant_options?.groups || [];
      setPicked(Object.fromEntries(groups.map((g) => [g.key, g.choices[0]?.label])));
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
    // A design restricted to certain metals only shows in those metals.
    const choices = (g.choices || []).filter(
      (c) => !c.metals?.length || c.metals.includes(resolved.metal)
    );
    if (!choices.length) continue;
    visible.push({ ...g, choices });
    const pick = picked[g.key];
    if (pick != null && choices.some((c) => c.label === pick)) resolved[g.key] = pick;
    else if (!g.optional) resolved[g.key] = choices[0].label;
  }

  const surchargeOf = (g) => {
    const c = g.choices.find((x) => x.label === resolved[g.key]);
    if (!c) return 0;
    // Making charges are a % of the stone's base price, not the running total.
    return (c.surcharge || 0) + Math.round((p.price * (c.surcharge_pct || 0)) / 100);
  };
  const unitPrice = visible.reduce((sum, g) => sum + surchargeOf(g), p.price);

  const addToCart = async () => {
    try {
      // Send only what's actually visible — a stale pick from a hidden group (e.g. a
      // ring size after switching back to Loose Gemstone) must not reach the cart.
      const options = {};
      for (const g of visible) if (resolved[g.key] != null) options[g.key] = resolved[g.key];
      await cart.add({ product_id: p.product_id, qty, options });
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
          <div className="mt-6 flex items-baseline gap-4">
            <div className="font-display text-4xl text-maroon-deep" data-testid="product-unit-price">{formatINR(unitPrice)}</div>
            {p.mrp && p.mrp > unitPrice && <div className="text-ink-muted line-through">{formatINR(p.mrp)}</div>}
          </div>
          {unitPrice !== p.price && (
            <div className="text-xs text-ink-muted mt-1">Base price {formatINR(p.price)} + your selected options</div>
          )}
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
                              {c.surcharge_pct > 0 && (
                                <div className="text-ink-muted">+{c.surcharge_pct}% Making Charges</div>
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
