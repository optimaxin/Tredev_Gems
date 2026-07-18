import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useSiteAssets } from "@/context/SiteAssetsContext";
import { YantraWatermark } from "@/components/gemora/Editorial";
import { api } from "@/lib/api";
import {
  bannerFor, copyFor, faqFor, CATEGORY_LABEL, CATEGORY_DEVA,
} from "@/lib/productCopy";
import {
  CaretDown, CaretRight, ShieldCheck, FlowerLotus, Drop, Sun, Moon, Leaf, HandHeart,
  Sparkle, Compass, QrCode, Ruler, Package, Clock, Scroll, Info, Coins, Medal, UserFocus,
} from "@phosphor-icons/react";

const ICONS = {
  drop: Drop, sun: Sun, moon: Moon, leaf: Leaf, lotus: FlowerLotus, hand: HandHeart,
  shield: ShieldCheck, qr: QrCode, sparkle: Sparkle, compass: Compass, ruler: Ruler,
  package: Package, clock: Clock, scroll: Scroll,
};
const Ico = ({ name, ...rest }) => {
  const C = ICONS[name] || Sparkle;
  return <C {...rest} />;
};

/* Renderers for each section-panel shape. */
function Prose({ text }) {
  return <p className="text-ink-soft leading-relaxed max-w-3xl">{text}</p>;
}
function Steps({ items }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
      {items.map((s, i) => (
        <div key={s.title || i} className="gold-line bg-ivory p-5">
          <div className="flex items-center justify-between">
            <Ico name={s.icon} size={24} weight="duotone" className="text-gold-soft" />
            <span className="font-display text-3xl text-cream select-none">{i + 1}</span>
          </div>
          {s.title && <div className="font-serifd text-lg text-maroon-deep mt-2">{s.title}</div>}
          <p className={`text-sm text-ink-soft leading-relaxed ${s.title ? "mt-1" : "mt-2"}`}>{s.body}</p>
        </div>
      ))}
    </div>
  );
}
function Faqs({ items }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="gold-line bg-ivory divide-y divide-gold/20 max-w-4xl">
      {items.map((f, i) => (
        <details key={i} open={open === i} onToggle={(e) => e.target.open && setOpen(i)} className="p-5 group">
          <summary className="cursor-pointer flex items-center justify-between gap-4 list-none">
            <span className="font-serifd text-lg text-ink">{f.q}</span>
            <CaretRight size={16} weight="bold" className="text-gold-soft group-open:rotate-90 transition-transform shrink-0" />
          </summary>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

export default function CategoryBanner({ category }) {
  const reduce = useReducedMotion();
  const { getAsset } = useSiteAssets();
  const [openKey, setOpenKey] = useState(null);
  // Admin-managed banner content for this category (see AdminCategories). Anything the
  // admin left blank simply isn't in this object, so it falls through to the built-ins.
  const [cat, setCat] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/categories")
      .then(({ data }) => alive && setCat((data.categories || []).find((c) => c.key === category) || null))
      .catch(() => {});
    return () => { alive = false; };
  }, [category]);

  const banner = bannerFor(category);
  const copy = copyFor(category);
  const db = cat?.banner || {};   // admin overrides — highest priority
  const pick = (v, fallback) => (v == null || v === "" ? fallback : v);
  const steps = (v, fallback) => (Array.isArray(v) && v.length ? v : fallback);

  const label = pick(cat?.label, CATEGORY_LABEL[category] || category?.replace(/_/g, " "));
  const deva = pick(cat?.hindi, CATEGORY_DEVA[category] || "");
  const badge = pick(db.badge_label, "Certified collection");
  // Precedence: admin banner > site-asset override > built-in default.
  const image = pick(db.image, getAsset(`shop_banner_${category}`, banner.image));
  const intro = pick(db.intro, getAsset(`shop_intro_${category}`, banner.intro));
  const ctaPrimary = { label: pick(db.cta_primary?.label, "Shop the collection"),
                       href: pick(db.cta_primary?.href, "#collection-grid") };
  const ctaSecondary = { label: pick(db.cta_secondary?.label, "Ask an astrologer"),
                         href: pick(db.cta_secondary?.href, "/consultation") };

  const sections = useMemo(() => [
    { key: "about", label: "About", Icon: Info, render: () => <Prose text={pick(db.about, getAsset(`shop_about_${category}`, banner.about))} /> },
    { key: "wear", label: "How to Wear", Icon: HandHeart, render: () => <Steps items={steps(db.how_to_wear, copy.ritual)} /> },
    { key: "who", label: "Who Should Wear", Icon: UserFocus, render: () => <Prose text={pick(db.who_should_wear, banner.whoShouldWear)} /> },
    { key: "care", label: "How to Care", Icon: Drop, render: () => <Steps items={steps(db.how_to_care, copy.care)} /> },
    { key: "benefits", label: "Benefits", Icon: Sparkle, render: () => <Steps items={steps(db.benefits, copy.benefits)} /> },
    { key: "quality", label: "Quality", Icon: Medal, render: () => <Prose text={pick(db.quality, banner.quality)} /> },
    { key: "price", label: "Price", Icon: Coins, render: () => <Prose text={pick(db.price, banner.price)} /> },
    { key: "faqs", label: "FAQs", Icon: QrCode, render: () => <Faqs items={steps(db.faqs, faqFor(category))} /> },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [category, copy, banner, db]);

  const active = sections.find((s) => s.key === openKey);

  // Internal paths use the router; external URLs (or plain #anchors) use a raw anchor.
  const Cta = ({ href, className, children }) =>
    href?.startsWith("/") ? <Link to={href} className={className}>{children}</Link>
      : <a href={href} className={className}>{children}</a>;

  return (
    <section className="relative bg-ivory overflow-hidden border-b border-gold/30" data-testid={`category-banner-${category}`}>
      {/* ── Compact rectangular band — fixed 9cm tall, never taller ── */}
      <div className="grid lg:grid-cols-2 lg:h-[9cm] lg:max-h-[9cm]">
        <div className="relative aspect-[16/9] lg:aspect-auto lg:h-full overflow-hidden bg-cream group order-1">
          <img
            src={image}
            alt={label}
            className={`w-full h-full object-cover ${reduce ? "" : "ken-burns"}`}
          />
          {/* fade the plate into the copy panel so there's no hard seam */}
          <div className="absolute inset-0 bg-gradient-to-t from-maroon-deep/25 to-transparent lg:bg-gradient-to-r lg:from-transparent lg:via-transparent lg:to-ivory pointer-events-none" />
          <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 bg-ivory/90 backdrop-blur border border-gold/40 px-2.5 py-1 text-[10px] uppercase tracking-widest text-verified">
            <ShieldCheck size={12} weight="duotone" /> {badge}
          </div>
        </div>

        <div className="relative order-2 px-6 sm:px-10 lg:pl-6 lg:pr-12 py-7 lg:py-6 flex flex-col justify-center overflow-hidden">
          <div className="grain absolute inset-0 pointer-events-none opacity-[0.6]" />
          {/* turning yantra watermark set into the copy panel */}
          <YantraWatermark className="pointer-events-none absolute -right-20 top-1/2 -translate-y-1/2 w-[280px] h-[280px] text-gold/[0.10] hidden lg:block" />
          <div className="relative max-w-xl">
            <div className="flex items-baseline gap-2.5">
              {deva && <span className="font-deva text-lg text-gold-soft">{deva}</span>}
              <span className="text-[11px] uppercase tracking-[0.3em] text-gold-soft">The Collection</span>
            </div>
            <h1 className="font-display text-3xl md:text-4xl text-ink mt-1.5 leading-[1.05]">{label}</h1>
            <div className="mt-2.5 h-[1px] w-16 bg-gold rule-draw" />
            <p className="mt-3 text-sm text-ink-soft leading-relaxed line-clamp-3">{intro}</p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Cta href={ctaPrimary.href} className="brand-gradient text-ivory px-5 py-2.5 text-[11px] uppercase tracking-widest inline-flex items-center gap-1.5 hover-lift">
                {ctaPrimary.label} <CaretRight size={12} weight="bold" />
              </Cta>
              <Cta href={ctaSecondary.href} className="border border-maroon text-maroon px-5 py-2.5 text-[11px] uppercase tracking-widest hover:bg-maroon hover:text-ivory transition-colors">
                {ctaSecondary.label}
              </Cta>
            </div>
          </div>
        </div>
      </div>

      {/* ── Expandable info bar ── */}
      <div className="border-t border-gold/30 bg-cream">
        <div className="mx-auto max-w-7xl flex flex-wrap items-stretch justify-center gap-x-1 gap-y-1 px-2 py-1">
          {sections.map((s) => {
            const on = openKey === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setOpenKey(on ? null : s.key)}
                aria-expanded={on}
                data-testid={`cat-section-${s.key}`}
                className={`inline-flex items-center gap-1.5 px-4 py-3 text-sm transition-colors ${
                  on ? "text-maroon-deep" : "text-ink-soft hover:text-maroon"
                }`}
              >
                <s.Icon size={15} weight="duotone" className={on ? "text-maroon" : "text-gold-soft"} />
                {s.label}
                <CaretDown size={11} weight="bold" className={`transition-transform ${on ? "rotate-180 text-maroon" : "text-ink-muted"}`} />
              </button>
            );
          })}
        </div>

        <AnimatePresence initial={false}>
          {active && (
            <motion.div
              key={openKey}
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduce ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
              className="overflow-hidden border-t border-gold/20 bg-ivory"
            >
              <div className="mx-auto max-w-7xl px-6 lg:px-10 py-8">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-[1px] w-8 bg-gold" />
                  <h2 className="font-serifd text-2xl text-maroon-deep">{active.label}</h2>
                  <span className="font-deva text-sm text-gold-soft">{deva}</span>
                </div>
                {active.render()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
