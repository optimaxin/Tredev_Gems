import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { api, mediaSrc } from "@/lib/api";
import { formatPrice } from "@/lib/currency";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import { ShieldCheck, Certificate, ShoppingBag, Heart, Plus, Minus, CaretLeft, CaretRight, Star, Truck, ArrowsClockwise, FlowerLotus, Lightning } from "@phosphor-icons/react";
import ProductStory from "@/components/gemora/ProductStory";
import AsyncButton from "@/components/gemora/AsyncButton";
import PoojaDetailsForm, { EMPTY_POOJA_DETAILS, validatePoojaDetails } from "@/components/gemora/PoojaDetailsForm";
import { CATEGORY_LABEL } from "@/lib/productCopy";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";

// The only two Pooja Energization choices that involve a video sankalp — the
// third (Basic Energization) is the free default and never needs wearer details.
const POOJA_VIDEO_CHOICES = [
  "SHUDH - Vedic Pooja with Video (Extra 2 Day)",
  "SHUDH - Prana Pratishta Pooja with Video (Extra 2 Day)",
];

// YouTube watch/share links don't embed directly — everything else (Drive
// preview links, already-embed URLs) is used as-is.
function toEmbedUrl(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/shorts\/)([\w-]+)/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : url;
}

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
  const [saved, setSaved] = useState(false); // optimistic "already in wishlist" flag
  const [buying, setBuying] = useState(false);
  const [poojaDetails, setPoojaDetails] = useState(EMPTY_POOJA_DETAILS);
  const [poojaSubmitAttempted, setPoojaSubmitAttempted] = useState(false); // reveals every field's error at once
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
    setSaved(false);
    setPoojaDetails(EMPTY_POOJA_DETAILS);
    setPoojaSubmitAttempted(false);

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

  // out_of_stock is computed server-side (staff's manual toggle, or zero serialized
  // units) — the count itself is never shown to buyers, only this flag. The quantity
  // stepper isn't capped to real stock either; checkout's stock guard is the real limit.
  const soldOut = !!p.out_of_stock;
  const maxQty = 99;

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

  // Option/design surcharges only ever carry an INR price plus one USD fallback
  // (no full per-currency matrix — see _compute_variant_price on the backend for
  // why). So checkout only ever charges in INR or USD; a choice's price in any
  // other currency is undefined. surchargeIn mirrors that: INR/USD resolve for
  // real, anything else (a product with an exact regional override but no
  // matching regional surcharge data) is treated as unpriced rather than guessed.
  const surchargeIn = (choice, currency) => {
    if (!choice) return 0;
    if (currency === "INR") return choice.surcharge || 0;
    if (currency === "USD") return choice.surcharge_usd || 0;
    return 0;
  };
  const pricedCurrency = p.currency === "INR" || p.currency === "USD";
  const unitPrice = !pricedCurrency ? p.price : visible.reduce((sum, g) => {
    const c = g.choices.find((x) => x.label === resolved[g.key]);
    return sum + surchargeIn(c, p.currency);
  }, p.price);

  // A video Pooja Energization needs the wearer's details for the temple's sankalp.
  const poojaTrigger = POOJA_VIDEO_CHOICES.includes(resolved.pooja_energization);
  const poojaValid = !poojaTrigger || Object.keys(validatePoojaDetails(poojaDetails)).length === 0;

  // Stops an add-to-cart when the pooja form is incomplete, revealing its errors
  // instead of silently failing. Returns whether the caller may proceed.
  const guardPooja = () => {
    if (poojaValid) return true;
    setPoojaSubmitAttempted(true);
    toast.error("Please complete the pooja details before adding to cart.");
    return false;
  };

  // Send only what's actually visible — a stale pick from a hidden group (e.g. a
  // ring size after switching back to Loose Gemstone) must not reach the cart.
  const put = async () => {
    const options = {};
    for (const g of visible) if (resolved[g.key] != null) options[g.key] = resolved[g.key];
    await cart.add({ product_id: p.product_id, qty, options, pooja_details: poojaTrigger ? poojaDetails : undefined });
  };

  // Optimistic: the cart page renders the new line immediately (CartContext seeds a
  // placeholder from optimisticItem) instead of waiting on the round trip. If the
  // request fails, CartContext rolls the cart back and this toast surfaces the error
  // wherever the user has landed by then.
  const addToCart = () => {
    if (!guardPooja()) return;
    const options = {};
    for (const g of visible) if (resolved[g.key] != null) options[g.key] = resolved[g.key];
    cart.add({
      product_id: p.product_id, qty, options,
      pooja_details: poojaTrigger ? poojaDetails : undefined,
      optimisticItem: { name: p.name, price: unitPrice, image: mediaSrc((p.images || [])[0]) || null },
    }).catch((e) => {
      toast.error(e.response?.data?.detail || "Could not add to cart");
    });
    toast.success(`${qty} × ${p.name} added to your cart`);
    nav("/cart");
  };

  const buyNow = async () => {
    if (!guardPooja()) return;
    setBuying(true);
    try {
      await put();
      nav("/checkout");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not add to cart");
      setBuying(false);
    }
  };

  // Optimistic: flips to "Saved" immediately; reverts (and the button re-enables)
  // if the request fails — most commonly because the buyer isn't logged in.
  const saveWishlist = () => {
    setSaved(true);
    api.post(`/me/wishlist/${p.product_id}`)
      .then(() => toast.success("Saved to wishlist"))
      .catch(() => {
        setSaved(false);
        toast.error("Please login to save");
      });
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
                      src={mediaSrc(images[idx])}
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
                        <img src={mediaSrc(im)} className="w-full h-full object-cover" alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            );
          })()}

          {p.video_url && (
            <div className="mt-3 aspect-video gold-line-strong overflow-hidden bg-cream">
              <iframe
                src={toEmbedUrl(p.video_url)}
                title={`${p.name} — video`}
                data-testid="product-video"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
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
            <div className="font-display text-4xl text-maroon-deep" data-testid="product-unit-price">{formatPrice(unitPrice, p.currency)}</div>
            {p.mrp && p.mrp > unitPrice && <div className="text-ink-muted line-through">{formatPrice(p.mrp, p.currency)}</div>}
            {off > 0 && (
              <span className="bg-maroon text-ivory text-[11px] font-mono px-2 py-1 tracking-widest">{off}% OFF</span>
            )}
          </div>
          {unitPrice !== p.price && (
            <div className="text-xs text-ink-muted mt-1">Base price {formatPrice(p.price, p.currency)} + your selected options</div>
          )}
          <div className="mt-6 max-w-prose space-y-4">
            {p.description.split(/\n\s*\n/).filter(Boolean).map((para, i) => (
              <p key={i} className="text-ink-soft leading-relaxed whitespace-pre-line">{para}</p>
            ))}
          </div>

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
                        const thumb = (
                          <button
                            type="button"
                            onClick={() => setPicked((s) => ({ ...s, [g.key]: c.label }))}
                            aria-pressed={on}
                            data-testid={`option-${g.key}-${c.label}`}
                            className={`text-center border p-1.5 transition-colors w-full ${
                              on ? "border-maroon bg-cream" : "border-gold/30 hover:border-maroon"
                            }`}
                          >
                            <div className="aspect-square overflow-hidden bg-ivory">
                              {c.image
                                ? <img src={mediaSrc(c.image)} alt={c.label} loading="lazy" className="w-full h-full object-contain" />
                                : <div className="w-full h-full flex items-center justify-center text-[10px] text-ink-muted">No image</div>}
                            </div>
                            <div className="mt-1 text-[11px] leading-tight">
                              <div className="font-medium">{c.label}</div>
                              {c.note && <div className="text-ink-muted">{c.note}</div>}
                              {pricedCurrency && surchargeIn(c, p.currency) > 0 && (
                                <div className="text-maroon-deep">+{formatPrice(surchargeIn(c, p.currency), p.currency)}</div>
                              )}
                            </div>
                          </button>
                        );
                        // Hover expands the thumbnail into a large preview — the
                        // grid renders these too small (a few dozen px) to judge a
                        // design by, and the buyer is choosing it sight-unseen otherwise.
                        if (!c.image) return <div key={c.label}>{thumb}</div>;
                        return (
                          <HoverCard key={c.label} openDelay={150} closeDelay={0}>
                            <HoverCardTrigger asChild>{thumb}</HoverCardTrigger>
                            <HoverCardContent side="top" align="center" className="w-64 h-64 p-2 bg-ivory">
                              <img src={mediaSrc(c.image)} alt={c.label} className="w-full h-full object-contain" />
                            </HoverCardContent>
                          </HoverCard>
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
                            {pricedCurrency && surchargeIn(c, p.currency) > 0 && <span className="text-xs text-ink-muted"> +{formatPrice(surchargeIn(c, p.currency), p.currency)}</span>}
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
                          {c.label}{pricedCurrency && surchargeIn(c, p.currency) > 0 ? ` (+${formatPrice(surchargeIn(c, p.currency), p.currency)})` : ""}
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
                  {g.key === "pooja_energization" && poojaTrigger && (
                    <PoojaDetailsForm
                      value={poojaDetails}
                      onChange={setPoojaDetails}
                      showErrors={poojaSubmitAttempted}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Quantity */}
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-ink-muted">Quantity</div>
              {soldOut && (
                <div className="text-xs text-revoked">Out of stock</div>
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
            <AsyncButton
              onClick={buyNow}
              loading={buying}
              loadingText="Processing…"
              data-testid="buy-now-btn"
              disabled={soldOut}
              className="border border-maroon bg-maroon text-ivory px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover:bg-maroon-deep transition-colors disabled:opacity-40"
            >
              <Lightning size={16} weight="fill" /> Buy it now
            </AsyncButton>
            <button
              onClick={saveWishlist}
              disabled={saved}
              className="border border-maroon text-maroon px-6 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover:bg-maroon hover:text-ivory transition-colors disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-maroon"
              data-testid="wishlist-btn"
            >
              <Heart size={16} weight={saved ? "fill" : "duotone"} /> {saved ? "Saved" : "Save"}
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
      <ProductStory
        p={p}
        reviews={reviews}
        onReviewAdded={(r) => setReviews((cur) => [r, ...cur])}
      />

      {/* Sticky buy bar — mobile only */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 sticky-rise bg-ivory/95 backdrop-blur border-t border-gold/40">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="min-w-0">
            <div className="font-display text-xl text-maroon-deep leading-none">{formatPrice(unitPrice, p.currency)}</div>
            {off > 0 && <div className="text-[10px] text-ink-muted line-through">{formatPrice(p.mrp, p.currency)}</div>}
          </div>
          <button
            onClick={addToCart}
            disabled={soldOut}
            data-testid="sticky-add-to-cart"
            className="ml-auto brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-40"
          >
            <ShoppingBag size={14} weight="duotone" /> {soldOut ? "Sold out" : "Add to cart"}
          </button>
          <AsyncButton
            onClick={buyNow}
            loading={buying}
            loadingText=""
            disabled={soldOut}
            className="bg-maroon text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2 disabled:opacity-40"
          >
            <Lightning size={14} weight="fill" /> Buy
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}
