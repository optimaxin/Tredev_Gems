import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatINR } from "@/lib/api";
import { ShieldCheck, QrCode, Certificate, Fingerprint, Sparkle, ArrowRight, Star, Truck, Package, HandHeart, CaretRight, CaretLeft, Play, ChatCircle, Calendar, Compass } from "@phosphor-icons/react";
import { HOME } from "@/constants/testIds";
import ProductCard from "@/components/gemora/ProductCard";
import CategoryRail from "@/components/gemora/CategoryRail"; // eslint-disable-line no-unused-vars
import ConsultMarquee from "@/components/gemora/ConsultMarquee";
import EventsSection from "@/components/gemora/EventsSection";
import AmbassadorHero from "@/components/gemora/AmbassadorHero";
import { OrnamentHeader } from "@/components/gemora/Ornament";
import { useSiteAssets } from "@/context/SiteAssetsContext";

const HERO_IMG = "https://images.unsplash.com/photo-1669256335723-1fa03d5123c0?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NDh8MHwxfHNlYXJjaHwyfHxJbmRpYW4lMjB0ZW1wbGUlMjBhcmNoaXRlY3R1cmUlMjBnb2xkJTIwZGV0YWlsc3xlbnwwfHx8fDE3ODM3Njc4NDd8MA&ixlib=rb-4.1.0&q=85";
const CRAFT_IMG = "https://images.pexels.com/photos/6207517/pexels-photo-6207517.jpeg";

const HERO_SLIDES = [
  {
    tag: "Est. Kashi · 2024",
    title: <>Anyone can <em className="font-serifd">claim</em> a stone is real.<br /> We let you <span className="brand-gradient-text">prove it.</span></>,
    sub: "Every gemstone, rudraksha and yantra you buy is a serialised, cryptographically signed physical unit. Verifiable with a public key from anywhere.",
    cta1: ["/shop", "Enter the store"], cta2: ["/verify", "Verify a QR"],
    img: HERO_IMG, deva: "सत्यम् एव जयते", devaSub: "Only truth prevails",
  },
  {
    tag: "The Navratna, individually signed",
    title: <>Nine stones. <br /> <span className="brand-gradient-text">Nine planets.</span> One promise.</>,
    sub: "Pukhraj, Neelam, Manik, Panna, Moti, Moonga, Heera, Gomed, Lehsuniya — every stone paired to its ruler, with its own lab report and temple energisation.",
    cta1: ["/shop-by-planet", "Shop the Navagraha"], cta2: ["/tools/carat-ratti", "Carat ↔ Ratti tool"],
    img: "https://images.pexels.com/photos/9953656/pexels-photo-9953656.jpeg",
    deva: "नवग्रह", devaSub: "The nine graha",
  },
  {
    tag: "Rudraksha · Nepal Original",
    title: <>Every bead, a blessing.<br /> <span className="brand-gradient-text">Every mukhi, a lineage.</span></>,
    sub: "Authentic 1 to 21 mukhi Nepal rudraksha, X-ray verified and energised at partner temples. No lookalike Indonesian passing off allowed.",
    cta1: ["/shop?category=rudraksha", "Explore Rudraksha"], cta2: ["/verify", "How we verify"],
    img: "https://images.unsplash.com/photo-1661915606983-cc9759b99343?w=1400",
    deva: "रुद्राक्ष", devaSub: "The tears of Rudra",
  },
];

const CATS = [
  { key: "gemstone", label: "Gemstones", hindi: "रत्न", img: "https://images.pexels.com/photos/9953656/pexels-photo-9953656.jpeg" },
  { key: "rudraksha", label: "Rudraksha", hindi: "रुद्राक्ष", img: "https://images.unsplash.com/photo-1661915606983-cc9759b99343?w=800" },
  { key: "bracelet", label: "Bracelets", hindi: "कड़ा", img: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=800" },
  { key: "yantra", label: "Yantras", hindi: "यंत्र", img: "https://images.unsplash.com/photo-1609619385076-36a873425636?w=800" },
  { key: "idol", label: "Idols", hindi: "मूर्ति", img: "https://images.unsplash.com/photo-1665579156897-b28f83a3fcbd?w=800" },
  { key: "prashad", label: "Temple Prashad", hindi: "प्रसाद", img: "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=800" },
];

const PURPOSES = [
  { key: "wealth", label: "Wealth", hindi: "धन", img: "https://images.pexels.com/photos/9953656/pexels-photo-9953656.jpeg" },
  { key: "protection", label: "Protection", hindi: "रक्षा", img: "https://images.unsplash.com/photo-1609619385076-36a873425636?w=1000" },
  { key: "love", label: "Love", hindi: "प्रेम", img: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=1000" },
  { key: "career", label: "Career", hindi: "करियर", img: "https://images.unsplash.com/photo-1544376664-80b17f09d399?w=1000" },
  { key: "health", label: "Health", hindi: "स्वास्थ्य", img: "https://images.unsplash.com/photo-1661915606983-cc9759b99343?w=1000" },
];

const PLANETS = [
  { name: "Sun", deva: "सूर्य", stone: "Ruby" },
  { name: "Moon", deva: "चंद्र", stone: "Pearl" },
  { name: "Mars", deva: "मंगल", stone: "Red Coral" },
  { name: "Mercury", deva: "बुध", stone: "Emerald" },
  { name: "Jupiter", deva: "गुरु", stone: "Yellow Sapphire" },
  { name: "Venus", deva: "शुक्र", stone: "Diamond" },
  { name: "Saturn", deva: "शनि", stone: "Blue Sapphire" },
  { name: "Rahu", deva: "राहु", stone: "Hessonite" },
  { name: "Ketu", deva: "केतु", stone: "Cat's Eye" },
];

const TESTIMONIALS = [
  { by: "Priya S., Mumbai", rating: 5, title: "Trust is what won me over", body: "The Pukhraj arrived with a signed certificate I could actually verify. I've never felt more sure about a stone in 15 years." },
  { by: "Arjun T., Bengaluru", rating: 5, title: "Beautiful Sri Yantra", body: "Energised at Kanchi as promised. Pooja recording was a lovely touch." },
  { by: "Neha K., Delhi", rating: 5, title: "The QR sold me", body: "I scanned before opening. Seeing the temple video and lab report right there is next-level." },
];

const POSTS = [
  { title: "How to wear a Yellow Sapphire (Pukhraj) — a complete guide", tag: "Guides", img: "https://images.pexels.com/photos/9953656/pexels-photo-9953656.jpeg" },
  { title: "Rudraksha mukhi meanings — 1 through 21", tag: "Rudraksha", img: "https://images.unsplash.com/photo-1661915606983-cc9759b99343?w=800" },
  { title: "Why Tredev signs every certificate with Ed25519", tag: "Trust", img: "https://images.pexels.com/photos/15286007/pexels-photo-15286007.jpeg" },
];

const FAQ = [
  { q: "How can I verify a Tredev certificate is real?", a: "Every certificate we issue is a canonical JSON payload signed with our Ed25519 private key. Our public key is published on our /api/ endpoint. Scan the QR on your certificate — it opens a verification page that recomputes the SHA-256 hash and checks the signature. You can independently verify the signature with any Ed25519 library." },
  { q: "Are the gemstones lab-certified?", a: "Yes. Every gemstone we sell carries a lab report from a GJEPC-affiliated laboratory (GJEPC, GIL, GJC or equivalent). The report number is embedded in the certificate and attached to the item's QR page." },
  { q: "What is 'temple energisation'?", a: "We take every high-value stone or rudraksha to a partner temple where a priest performs a puja on your item. We record the puja (audio) and the priest signs the energisation record. It's not required for authenticity — it's a service for buyers who want it done reverently." },
  { q: "Why is the QR sometimes 'SUSPICIOUS'?", a: "Because we mint the QR when the certificate is issued but only ACTIVATE it when we dispatch the physical item. If someone printed a fake label off the internet and you scanned it before we shipped, it correctly reads suspicious. It's how a public scan can flag a fake before your parcel even arrives." },
  { q: "What if I return the item?", a: "The certificate is revoked. The QR then reads REVOKED forever — so the old certificate can never vouch for the returned unit again." },
  { q: "Do you ship internationally?", a: "Yes, we ship worldwide via insured logistics. Duties and taxes are borne by the buyer. Certificates travel with the parcel; the QR activates on our dispatch scan." },
];

export default function Home() {
  const [products, setProducts] = useState([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [finder, setFinder] = useState({ category: "gemstone", type: "", price: "" });
  const [openFaq, setOpenFaq] = useState(0);
  const nav = useNavigate();
  const { getAsset } = useSiteAssets();

  // Apply admin-managed slot overrides on top of the default HERO_SLIDES / CATS / PURPOSES.
  const heroSlides = useMemo(
    () => HERO_SLIDES.map((s, i) => ({ ...s, img: getAsset(`home_hero_${i + 1}`, s.img) })),
    [getAsset]
  );
  const cats = useMemo(
    () => CATS.map((c) => ({ ...c, img: getAsset(`home_cat_${c.key}`, c.img) })),
    [getAsset]
  );
  const purposes = useMemo(
    () => PURPOSES.map((p) => ({ ...p, img: getAsset(`home_purpose_${p.key}`, p.img) })),
    [getAsset]
  );
  const posts = useMemo(
    () => POSTS.map((p, i) => ({ ...p, img: getAsset(`home_blog_${i + 1}`, p.img) })),
    [getAsset]
  );
  const astroBandBg = getAsset("home_astro_band_bg", "https://images.pexels.com/photos/15286007/pexels-photo-15286007.jpeg");
  const verifyBandBg = getAsset("home_verify_band_bg", "https://images.pexels.com/photos/15286007/pexels-photo-15286007.jpeg");
  const craftPoster = getAsset("home_craft_poster", CRAFT_IMG);

  useEffect(() => {
    api.get("/products?limit=12").then(({ data }) => setProducts(data)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroSlides.length), 7000);
    return () => clearInterval(t);
  }, [heroSlides.length]);

  const bestsellers = useMemo(() => products.slice(0, 6), [products]);
  const newArrivals = useMemo(() => [...products].reverse().slice(0, 6), [products]);
  const slide = heroSlides[heroIdx];

  const findGo = (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (finder.category) p.set("category", finder.category);
    if (finder.type) p.set("purpose", finder.type);
    nav(`/shop?${p.toString()}`);
  };

  return (
    <div className="bg-ivory">
      {/* BRAND AMBASSADOR — featured at the very top */}
      <AmbassadorHero />

      {/* HERO carousel */}
      <section data-testid={HOME.hero} className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-14 pb-20 grid lg:grid-cols-12 gap-14 items-center">
          <div className="lg:col-span-7 fade-up" key={heroIdx}>
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-maroon border border-gold/50 px-3 py-1.5">
              <Sparkle size={14} weight="duotone" /> {slide.tag}
            </div>
            <h1 className="mt-6 font-display text-5xl md:text-6xl leading-[1.02] tracking-tight text-ink">{slide.title}</h1>
            <p className="mt-8 text-base md:text-lg text-ink-soft max-w-2xl leading-relaxed">{slide.sub}</p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link to={slide.cta1[0]} data-testid={HOME.ctaShop} className="brand-gradient text-ivory px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover-lift">
                {slide.cta1[1]} <ArrowRight size={16} />
              </Link>
              <Link to={slide.cta2[0]} data-testid={HOME.ctaVerify} className="border border-maroon text-maroon px-8 py-4 text-sm uppercase tracking-widest inline-flex items-center gap-2 hover:bg-maroon hover:text-ivory transition-colors">
                <ShieldCheck size={16} weight="duotone" /> {slide.cta2[1]}
              </Link>
            </div>
            <div className="mt-10 flex items-center gap-3">
              {heroSlides.map((_, i) => (
                <button
                  key={i}
                  aria-label={`slide ${i + 1}`}
                  onClick={() => setHeroIdx(i)}
                  data-testid={`hero-dot-${i}`}
                  className={`h-[3px] transition-all ${i === heroIdx ? "w-12 bg-maroon" : "w-6 bg-gold/40 hover:bg-gold-soft"}`}
                />
              ))}
              <button aria-label="prev" onClick={() => setHeroIdx((i) => (i - 1 + heroSlides.length) % heroSlides.length)} className="ml-3 text-ink-muted hover:text-maroon"><CaretLeft size={16} /></button>
              <button aria-label="next" onClick={() => setHeroIdx((i) => (i + 1) % heroSlides.length)} className="text-ink-muted hover:text-maroon"><CaretRight size={16} /></button>
            </div>
          </div>
          <div className="lg:col-span-5 relative" key={`img-${heroIdx}`}>
            <div className="relative aspect-[4/5] overflow-hidden gold-line-strong fade-up">
              <img src={slide.img} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-maroon-deep/80 to-transparent">
                <div className="font-deva text-2xl text-ivory">"{slide.deva}"</div>
                <div className="text-xs text-ivory/80 mt-1 tracking-widest uppercase">{slide.devaSub}</div>
              </div>
            </div>
            <div className="absolute -bottom-6 -left-6 bg-ivory border border-gold-soft/50 px-4 py-3 shadow-md hidden md:block">
              <div className="text-[10px] uppercase tracking-widest text-verified font-mono">✓ AUTHENTIC</div>
              <div className="text-xs text-ink-soft mt-0.5 font-mono">sig: 8f2a·ce41·b039</div>
            </div>
          </div>
        </div>
        <div className="brand-gradient h-[2px] w-full" />
      </section>

      {/* HOMEPAGE EVENTS SECTION (admin-managed) */}
      <EventsSection />

      {/* TRUST STRIP */}
      <section className="bg-cream border-b border-gold/30 py-8" aria-label="Our guarantees">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            [ShieldCheck, "Lab-Certified", "Every stone, every batch"],
            [Certificate, "Ed25519 Signed", "Verifiable by anyone"],
            [Truck, "Insured Shipping", "48h dispatch, tracked"],
            [HandHeart, "Ethically Sourced", "Priest & lineage traced"],
          ].map(([Icon, h, s], i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Icon size={28} weight="duotone" className="text-gold-soft" />
              <div className="font-serifd text-lg text-maroon-deep">{h}</div>
              <div className="text-xs text-ink-muted">{s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CATEGORY TILES */}
      <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
        <OrnamentHeader eyebrow="Product Range · अन्वेषण" title="Our Premium Categories" />
        <div className="mt-12 grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {cats.map((c) => (
            <Link
              key={c.key}
              to={`/shop?category=${c.key}`}
              data-testid={`${HOME.categoryCard}-${c.key}`}
              className="relative group overflow-hidden gold-line aspect-[4/5]"
            >
              <img src={c.img} alt={c.label} className="w-full h-full object-cover img-hover" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-maroon-deep/70 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6">
                <div className="font-deva text-gold-soft text-base">{c.hindi}</div>
                <div className="font-display text-2xl md:text-3xl text-ivory mt-1">{c.label}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* CONSULT MARQUEE */}
      <ConsultMarquee />

      {/* FIND YOUR PRODUCT */}
      <section className="bg-cream border-y border-gold/30">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 py-16 grid lg:grid-cols-[1fr_2fr] gap-10 items-center">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Find your fit · मार्गदर्शन</div>
            <h2 className="font-display text-3xl md:text-4xl text-ink mt-3">Not sure where to start?</h2>
            <p className="text-sm text-ink-soft mt-3">A 10-second finder. For deeper guidance, our <Link to="/consultation" className="text-maroon underline decoration-gold-soft">astrologers</Link> are one call away.</p>
          </div>
          <form onSubmit={findGo} className="gold-line-strong bg-ivory p-6 grid sm:grid-cols-4 gap-4 items-end">
            <label className="block sm:col-span-1">
              <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">Category</div>
              <select value={finder.category} onChange={(e) => setFinder({ ...finder, category: e.target.value })} className="w-full gold-line px-3 py-2 bg-ivory">
                {CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <label className="block sm:col-span-1">
              <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">Purpose</div>
              <select value={finder.type} onChange={(e) => setFinder({ ...finder, type: e.target.value })} className="w-full gold-line px-3 py-2 bg-ivory">
                <option value="">Any</option>
                {PURPOSES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <label className="block sm:col-span-1">
              <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">Budget</div>
              <select value={finder.price} onChange={(e) => setFinder({ ...finder, price: e.target.value })} className="w-full gold-line px-3 py-2 bg-ivory">
                <option value="">Any</option>
                <option value="lo">Under ₹10k</option>
                <option value="md">₹10k – ₹1L</option>
                <option value="hi">₹1L+</option>
              </select>
            </label>
            <button data-testid="finder-submit" className="brand-gradient text-ivory h-[42px] text-xs uppercase tracking-widest inline-flex items-center justify-center gap-2 hover-lift">
              <Compass size={14} weight="duotone" /> Find
            </button>
          </form>
        </div>
      </section>

      {/* ASTROLOGER PROMO BAND */}
      <section className="relative overflow-hidden bg-maroon-deep text-ivory py-14">
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: `url('${astroBandBg}')`, backgroundSize: "cover", backgroundPosition: "center" }} />
        <div className="relative mx-auto max-w-7xl px-6 lg:px-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gold">Guidance · परामर्श</div>
            <h3 className="font-display text-3xl md:text-4xl mt-2">Talk to a verified astrologer.</h3>
            <p className="text-sm text-ivory/80 mt-2 max-w-2xl">Not a chatbot. A human, on a scheduled call. Personalised gemstone and rudraksha recommendations, without guesswork.</p>
          </div>
          <div className="flex gap-3">
            <Link to="/consultation" className="brand-gradient text-ivory px-6 py-3 text-xs uppercase tracking-widest hover-lift flex items-center gap-2">
              <Calendar size={14} weight="duotone" /> Book a call
            </Link>
            <Link to="/tools/carat-ratti" className="border border-gold text-gold px-6 py-3 text-xs uppercase tracking-widest hover:bg-gold hover:text-maroon-deep transition-colors">
              Free tool
            </Link>
          </div>
        </div>
      </section>

      {/* BESTSELLERS */}
      <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Bestsellers · लोकप्रिय</div>
            <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">What our seekers love</h2>
          </div>
          <Link to="/shop" className="text-sm text-maroon underline underline-offset-4 decoration-gold-soft">View all →</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {bestsellers.slice(0, 8).map((p) => <ProductCard key={p.product_id} p={p} />)}
        </div>
      </section>

      {/* GEMSTONES BY PLANET SPOTLIGHT */}
      <section className="bg-cream border-y border-gold/30 py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Navagraha · नवग्रह</div>
          <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">Every gem has a purpose.</h2>
          <p className="text-sm text-ink-soft mt-3 max-w-2xl">Each Navratna stone is ruled by a planet. Pick your ruler — we'll show you the stones and the certified units currently in the vault.</p>
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-3">
            {PLANETS.map((p) => (
              <Link key={p.name} to={`/shop?graha=${encodeURIComponent(p.name)}`} className="gold-line bg-ivory p-4 text-center hover-lift">
                <div className="font-deva text-xl text-maroon-deep">{p.deva}</div>
                <div className="font-serifd text-sm text-ink mt-1">{p.name}</div>
                <div className="text-[10px] text-ink-muted mt-1">{p.stone}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* NEW ARRIVALS */}
      <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Fresh in the vault</div>
            <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">New arrivals</h2>
          </div>
          <Link to="/shop" className="text-sm text-maroon underline underline-offset-4 decoration-gold-soft">View all →</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {newArrivals.slice(0, 8).map((p) => <ProductCard key={p.product_id} p={p} />)}
        </div>
      </section>

      {/* SHOP BY PURPOSE */}
      <section className="bg-cream border-y border-gold/30 py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Intent · संकल्प</div>
          <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">Shop by purpose</h2>
          <div className="mt-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {purposes.map((p) => (
              <Link key={p.key} to={`/shop-by-purpose`} className="relative overflow-hidden gold-line hover-lift aspect-[3/4]">
                <img src={p.img} alt={p.label} className="w-full h-full object-cover img-hover" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-maroon-deep/85 via-maroon-deep/30 to-transparent" />
                <div className="absolute bottom-4 left-4 right-4">
                  <div className="font-deva text-gold text-sm">{p.hindi}</div>
                  <div className="font-display text-2xl text-ivory mt-1">{p.label}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* PROOF STRIP — verify preview */}
      <section className="bg-maroon-deep text-ivory py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: "url('https://images.pexels.com/photos/15286007/pexels-photo-15286007.jpeg')",
          backgroundSize: "cover", backgroundPosition: "center"
        }} />
        <div className="relative mx-auto max-w-7xl px-6 lg:px-10 grid lg:grid-cols-12 gap-14 items-center">
          <div className="lg:col-span-6">
            <div className="text-xs uppercase tracking-[0.3em] text-gold">The one thing no one else does</div>
            <h2 className="font-display text-4xl md:text-5xl mt-4 leading-tight">A public key you can check<br /> against, from anywhere.</h2>
            <p className="mt-6 text-ivory/85 leading-relaxed max-w-xl">
              Our certificates are canonical JSON payloads signed with an Ed25519 private key kept behind a vault. Anyone — you, a jeweller, an appraiser — can independently verify a Tredev certificate using the public key.
            </p>
            <Link to="/verify" className="mt-8 inline-flex items-center gap-2 border border-gold text-gold px-6 py-3 text-sm uppercase tracking-widest hover:bg-gold hover:text-maroon-deep transition-colors" data-testid="home-verify-strip">
              <QrCode size={16} weight="duotone" /> Try the verify page
            </Link>
          </div>
          <div className="lg:col-span-6">
            <div className="border border-gold/40 p-8 bg-maroon-deep/60 backdrop-blur">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono tracking-widest text-gold">TREDEV://verify</div>
                <div className="text-verified text-xs font-mono">● AUTHENTIC</div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
                <div>
                  <div className="text-ivory/60 text-[10px] uppercase tracking-widest">Serial</div>
                  <div className="font-mono mt-1">GEM-YELLOW-3F9A2C</div>
                </div>
                <div>
                  <div className="text-ivory/60 text-[10px] uppercase tracking-widest">Temple</div>
                  <div className="font-deva text-lg mt-1 text-gold">काशी विश्वनाथ</div>
                </div>
                <div>
                  <div className="text-ivory/60 text-[10px] uppercase tracking-widest">Lab Report</div>
                  <div className="font-mono mt-1">GJ-8F2A4B</div>
                </div>
                <div>
                  <div className="text-ivory/60 text-[10px] uppercase tracking-widest">Issued</div>
                  <div className="font-mono mt-1">15 Jan 2026</div>
                </div>
              </div>
              <div className="mt-6 border-t border-gold/30 pt-4">
                <div className="text-ivory/60 text-[10px] uppercase tracking-widest">Ed25519 Signature</div>
                <div className="font-mono text-[11px] mt-1 break-all text-ivory/80">
                  8f2a4bce9d1e0f38b53a71c9e64f0d1a8c5b73e2f409d1c6a7b3e8f2d5c1a9047…
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CRAFTSMANSHIP BAND */}
      <section className="mx-auto max-w-7xl px-6 lg:px-10 py-24 grid lg:grid-cols-2 gap-14 items-center">
        <div className="relative overflow-hidden gold-line-strong aspect-[4/3]">
          <img src={craftPoster} alt="Artisan at work" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-tr from-maroon-deep/40 to-transparent" />
          <button className="absolute inset-0 flex items-center justify-center text-ivory" aria-label="Play brand video">
            <span className="w-16 h-16 bg-ivory/90 flex items-center justify-center text-maroon-deep border border-gold">
              <Play size={22} weight="fill" />
            </span>
          </button>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">The house · घर</div>
          <h2 className="font-display text-4xl md:text-5xl text-ink mt-3 leading-tight">Sourced by hand.<br />Signed by us.</h2>
          <p className="mt-5 text-ink-soft leading-relaxed">
            Our team walks the same mines in Ceylon, the same tantric ateliers in Kanchi, the same forests of Kathmandu that families have visited for generations. Every unit is intake-photographed, weighed, X-rayed where needed, and stored in the Tredev vault before it's ever offered for sale.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-ink-soft">
            <li className="flex gap-2"><Package size={16} className="text-gold-soft shrink-0" weight="duotone" /> First-party: we own every SKU we sell.</li>
            <li className="flex gap-2"><Fingerprint size={16} className="text-gold-soft shrink-0" weight="duotone" /> Serialised: every unit gets a fingerprint.</li>
            <li className="flex gap-2"><HandHeart size={16} className="text-gold-soft shrink-0" weight="duotone" /> Reverent: priests, not marketers, do the pooja.</li>
          </ul>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="bg-cream border-y border-gold/30 py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">In their words · ग्राहक</div>
              <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">People who believed us — then verified.</h2>
            </div>
            <div className="hidden md:flex items-center gap-2 text-sm text-ink-soft">
              <Star size={16} weight="fill" className="text-gold" /> <span className="font-mono">4.9 / 5</span> · 1,200+ verified reviews
            </div>
          </div>
          <div className="mt-10 grid md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="gold-line bg-ivory p-6">
                <div className="text-gold flex gap-0.5">{Array.from({ length: t.rating }).map((_, k) => <Star key={k} size={14} weight="fill" />)}</div>
                <div className="font-serifd text-lg text-ink mt-3">{t.title}</div>
                <p className="text-sm text-ink-soft mt-2 leading-relaxed">"{t.body}"</p>
                <div className="mt-4 text-xs text-ink-muted flex items-center gap-2">
                  <ChatCircle size={12} weight="duotone" /> {t.by}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BLOG PREVIEW */}
      <section className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Read · पढ़ें</div>
            <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">From the Tredev journal</h2>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {posts.map((p) => (
            <article key={p.title} className="gold-line bg-ivory overflow-hidden hover-lift">
              <div className="aspect-[16/10] overflow-hidden">
                <img src={p.img} alt={p.title} className="w-full h-full object-cover img-hover" />
              </div>
              <div className="p-5">
                <div className="text-[10px] uppercase tracking-widest text-gold-soft">{p.tag}</div>
                <div className="font-serifd text-xl text-ink mt-2 leading-snug">{p.title}</div>
                <div className="text-xs text-maroon mt-3 inline-flex items-center gap-1">Read the guide <ArrowRight size={10} /></div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* FAQ + SEO BLOCK */}
      <section className="mx-auto max-w-4xl px-6 lg:px-10 py-20">
        <div className="text-center">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Straight answers · प्रश्न</div>
          <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">Frequently asked</h2>
        </div>
        <div className="mt-10 gold-line bg-ivory divide-y divide-gold/20">
          {FAQ.map((f, i) => (
            <details
              key={i}
              open={openFaq === i}
              onToggle={(e) => e.target.open && setOpenFaq(i)}
              className="p-5 group"
              data-testid={`faq-${i}`}
            >
              <summary className="cursor-pointer flex items-center justify-between gap-4 list-none">
                <span className="font-serifd text-lg text-ink">{f.q}</span>
                <CaretRight size={16} weight="bold" className="text-gold-soft group-open:rotate-90 transition-transform" />
              </summary>
              <p className="mt-3 text-sm text-ink-soft leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
        {/* Structured data — FAQPage */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org", "@type": "FAQPage",
            mainEntity: FAQ.map((f) => ({
              "@type": "Question", name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a }
            }))
          }) }}
        />
      </section>

      {/* SMALL PROMISE */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <div className="font-deva text-2xl text-gold-soft">"न हि सत्यात् परो धर्मः"</div>
        <div className="mt-3 text-xs tracking-widest uppercase text-ink-muted">There is no greater dharma than truth</div>
        <p className="mt-8 text-ink-soft leading-relaxed">
          Tredev is not a marketplace. We source. We serialise. We certify. We ship. If a stone we sold is ever proven inauthentic, we make it right — no exceptions.
        </p>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-cream border-y border-gold/30 py-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 text-center">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Simple & Transparent</div>
          <h2 className="font-display text-4xl md:text-5xl text-ink mt-2">How It <em className="font-serifd">Works</em></h2>
          <p className="mt-3 text-ink-soft">From discovery to doorstep — your journey in three steps.</p>
          <div className="mt-12 grid md:grid-cols-3 gap-6 text-left">
            {[
              ["STEP 01", "Discover & Consult", "Take the finder quiz or book a free astro consultation to find the stone written in your stars."],
              ["STEP 02", "Certify & Energize", "Your unit is lab-tested, temple-energised by our in-house pandits, then Ed25519-signed."],
              ["STEP 03", "Wear & Verify", "Receive in premium packaging with a per-unit QR — scan anywhere to prove authenticity forever."],
            ].map(([k, t, d], i) => (
              <div key={i} className="gold-line-strong bg-ivory p-8 relative">
                <div className="absolute -top-4 left-8 brand-gradient text-ivory text-[10px] tracking-widest px-3 py-1 uppercase font-mono">{k}</div>
                <div className="font-display text-3xl text-maroon-deep mt-3">{t}</div>
                <p className="mt-3 text-sm text-ink-soft leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CERTIFICATIONS */}
      <section className="mx-auto max-w-6xl px-6 lg:px-10 py-16 text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Authenticity</div>
        <h2 className="font-display text-3xl md:text-4xl text-ink mt-2">A promise of purity <em className="font-serifd">& authenticity</em></h2>
        <div className="mt-10 flex items-center justify-center gap-8 md:gap-14 flex-wrap opacity-80">
          {[
            ["GJEPC", "Gem & Jewellery Export Promotion Council"],
            ["GIA", "Gemological Institute of America"],
            ["IGI", "International Gemological Institute"],
            ["BIS", "Bureau of Indian Standards"],
          ].map(([abbr, name]) => (
            <div key={abbr} className="text-center gold-line px-6 py-4 bg-ivory min-w-[140px]">
              <div className="font-display text-3xl text-maroon-deep">{abbr}</div>
              <div className="text-[10px] uppercase tracking-widest text-ink-muted mt-1">{name}</div>
            </div>
          ))}
        </div>
        <div className="mt-8 text-sm text-ink-soft max-w-2xl mx-auto">
          Every Tredev certificate is additionally signed with a <span className="font-mono text-maroon">Ed25519</span> key. Verify our claim independently — no other retailer offers this.
        </div>
      </section>

      {/* Also available on */}
      <section className="bg-cream border-y border-gold/30 py-12">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 text-center">
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Also available on</div>
          <div className="mt-6 flex items-center justify-center gap-10 flex-wrap text-ink-muted font-display text-2xl">
            <span>Amazon</span><span>·</span><span>Flipkart</span><span>·</span><span>Myntra</span><span>·</span><span>Blinkit</span>
          </div>
        </div>
      </section>
    </div>
  );
}
