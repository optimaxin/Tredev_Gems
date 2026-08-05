import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { MagnifyingGlass, ShoppingBagOpen, User, List, X, ShieldCheck, CaretDown } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { api } from "@/lib/api";
import { NAV } from "@/constants/testIds";
import AnnouncementBar from "@/components/gemora/AnnouncementBar";
import SearchOverlay from "@/components/gemora/SearchOverlay";
import CartDrawer from "@/components/gemora/CartDrawer";
import logo from "@/assets/logo.png";

// Verify-CTA style presets an admin can pick between (Admin → Website → Header) —
// bounded to the button looks already used elsewhere on the site, not free-form CSS.
const VERIFY_CTA_STYLES = {
  text: "hidden md:flex items-center gap-1.5 text-sm text-verified font-semibold",
  outline: "hidden md:flex items-center gap-1.5 text-sm border border-maroon text-maroon px-4 py-2 hover:bg-maroon hover:text-ivory transition-colors",
  solid: "hidden md:flex items-center gap-1.5 text-sm brand-gradient text-ivory px-4 py-2",
};

// Fallback nav/promo/CTA — used until /site-content's `header` block loads (and as
// the shape an admin edit is merged over), so the header never renders empty.
const DEFAULT_MEGA = [
  {
    key: "rudraksha", label: "Rudraksha", hindi: "रुद्राक्ष",
    columns: [
      { title: "Shop by Mukhi", items: [
        { label: "1 Mukhi (Ganesh)", href: "/shop?category=rudraksha" },
        { label: "5 Mukhi", href: "/shop?category=rudraksha&mukhi=5" },
        { label: "7 Mukhi (Lakshmi)", href: "/shop?category=rudraksha&mukhi=7" },
        { label: "8 Mukhi (Ketu)", href: "/shop?category=rudraksha&mukhi=8" },
        { label: "Gauri Shankar", href: "/shop?category=rudraksha" },
      ]},
      { title: "By Purpose", items: [
        { label: "Wealth", href: "/shop?category=rudraksha&purpose=wealth" },
        { label: "Health", href: "/shop?category=rudraksha&purpose=health" },
        { label: "Protection", href: "/shop?category=rudraksha&purpose=protection" },
        { label: "Career", href: "/shop?category=rudraksha&purpose=career" },
      ]},
      { title: "Origin & Kavach", items: [
        { label: "Nepal (Original)", href: "/shop?category=rudraksha" },
        { label: "Indonesian", href: "/shop?category=rudraksha" },
        { label: "Kavach Combos", href: "/shop?category=rudraksha" },
      ]},
    ],
  },
  {
    key: "gemstone", label: "Gemstones", hindi: "रत्न",
    columns: [
      { title: "Navratna (nine)", items: [
        { label: "Yellow Sapphire (Pukhraj)", href: "/shop?graha=Jupiter" },
        { label: "Blue Sapphire (Neelam)", href: "/shop?graha=Saturn" },
        { label: "Ruby (Manik)", href: "/shop?graha=Sun" },
        { label: "Emerald (Panna)", href: "/shop?graha=Mercury" },
        { label: "Pearl (Moti)", href: "/shop?graha=Moon" },
        { label: "Red Coral (Moonga)", href: "/shop?graha=Mars" },
        { label: "Diamond (Heera)", href: "/shop?graha=Venus" },
        { label: "Hessonite (Gomed)", href: "/shop?graha=Rahu" },
        { label: "Cat's Eye (Lehsuniya)", href: "/shop?graha=Ketu" },
      ]},
      { title: "By Origin", items: [
        { label: "Ceylon", href: "/shop?category=gemstone" },
        { label: "Kashmir", href: "/shop?category=gemstone" },
        { label: "Burma", href: "/shop?category=gemstone" },
        { label: "Zambian", href: "/shop?category=gemstone" },
      ]},
      { title: "By Rashi", items: [
        { label: "Sagittarius / धनु", href: "/shop" },
        { label: "Capricorn / मकर", href: "/shop" },
        { label: "Leo / सिंह", href: "/shop" },
      ]},
    ],
  },
  {
    key: "bracelet", label: "Bracelets & Mala", hindi: "कड़ा · माला",
    columns: [
      { title: "Bracelets", items: [
        { label: "Rudraksha Bracelets", href: "/shop?category=bracelet" },
        { label: "Zodiac Bracelets", href: "/shop?category=bracelet" },
        { label: "Crystal Bracelets", href: "/shop?category=bracelet" },
      ]},
      { title: "Malas", items: [
        { label: "Rudraksha Mala (108)", href: "/shop?category=bracelet" },
        { label: "Tulsi Mala", href: "/shop?category=bracelet" },
        { label: "Sphatik Mala", href: "/shop?category=bracelet" },
      ]},
    ],
  },
  {
    key: "yantra", label: "Yantras & Pooja", hindi: "यंत्र · पूजा",
    columns: [
      { title: "Yantras", items: [
        { label: "Sri Yantra", href: "/shop?category=yantra" },
        { label: "Kuber Yantra", href: "/shop?category=yantra" },
        { label: "Navagraha Yantra", href: "/shop?category=yantra" },
      ]},
      { title: "Idols · मूर्ति", items: [
        { label: "Ganesha", href: "/shop?category=idol" },
        { label: "Krishna", href: "/shop?category=idol" },
        { label: "Devi", href: "/shop?category=idol" },
      ]},
      { title: "Prashad · प्रसाद", items: [
        { label: "Tirupati Laddu", href: "/shop?category=prashad" },
        { label: "Ayodhya Prashad", href: "/shop?category=prashad" },
      ]},
    ],
  },
  {
    key: "purpose", label: "Shop by Purpose", hindi: "उद्देश्य",
    columns: [
      { title: "Life goals", items: [
        { label: "Wealth · धन", href: "/shop-by-purpose" },
        { label: "Protection · रक्षा", href: "/shop-by-purpose" },
        { label: "Love · प्रेम", href: "/shop-by-purpose" },
        { label: "Career · करियर", href: "/shop-by-purpose" },
        { label: "Health · स्वास्थ्य", href: "/shop-by-purpose" },
      ]},
    ],
  },
  {
    key: "consult", label: "Consult & Tools", hindi: "परामर्श",
    columns: [
      { title: "Free tools", items: [
        { label: "Carat ↔ Ratti", href: "/tools/carat-ratti" },
        { label: "Lucky Rudraksha Finder", href: "/tools/lucky-rudraksha" },
      ]},
      { title: "Consult", items: [
        { label: "Book an Astrologer", href: "/consultation" },
      ]},
      { title: "Trust", items: [
        { label: "Verify a QR", href: "/verify" },
        { label: "The provenance chain", href: "/verify" },
      ]},
    ],
  },
];

const DEFAULT_PROMO = {
  eyebrow: "The Tredev promise", title: "Every item, provably real.",
  body: "Serialised. Certified. Ed25519 signed. Scan the QR — verify anywhere.",
  cta_label: "Verify a stone", cta_href: "/verify",
};
const DEFAULT_VERIFY_CTA = { label: "Verify", href: "/verify", style: "text" };

export default function Header() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const [mega, setMega] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const nav = useNavigate();
  const location = useLocation();

  // Admin-edited nav/promo/CTA (Admin → Website → Header); merged over the
  // built-in defaults so the header is never empty before this resolves.
  const [megaNav, setMegaNav] = useState(DEFAULT_MEGA);
  const [promo, setPromo] = useState(DEFAULT_PROMO);
  const [verifyCta, setVerifyCta] = useState(DEFAULT_VERIFY_CTA);
  useEffect(() => {
    api.get("/site-content").then(({ data }) => {
      const h = data?.header;
      if (h?.nav?.length) setMegaNav(h.nav);
      if (h?.promo) setPromo(h.promo);
      if (h?.verify_cta) setVerifyCta(h.verify_cta);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => { setMega(null); setOpen(false); }, [location.pathname]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { setShowSearch(false); setShowCart(false); setMega(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <AnnouncementBar />
      <header
        className={`sticky top-0 z-40 bg-ivory/90 backdrop-blur-xl border-b border-gold/30 ${scrolled ? "shadow-sm" : ""}`}
        onMouseLeave={() => setMega(null)}
      >
        <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-3 pb-2 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5 shrink-0" data-testid={NAV.brand}>
            <img
              src={logo}
              alt="Tredev"
              className={`rounded-full ring-1 ring-gold/50 object-cover transition-all duration-200 ${scrolled ? "h-9 w-9" : "h-11 w-11"}`}
            />
            <span className="flex items-baseline gap-2">
              <span className={`font-display tracking-tight text-maroon-deep ${scrolled ? "text-2xl" : "text-3xl"}`}>Tredev</span>
              <span className="font-deva text-xs text-gold-soft hidden sm:inline">रत्न · प्रमाण</span>
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-4 xl:gap-6 ml-3">
            {megaNav.map((m) => (
              <button
                key={m.key}
                onMouseEnter={() => setMega(m.key)}
                onClick={() => setMega(mega === m.key ? null : m.key)}
                data-testid={`nav-mega-${m.key}`}
                className={`flex items-center gap-1 shrink-0 whitespace-nowrap text-sm font-medium ${mega === m.key ? "text-maroon-deep" : "text-ink-soft hover:text-maroon"}`}
              >
                {m.label} <CaretDown size={10} weight="bold" className="shrink-0" />
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-4 ml-auto">
            <button onClick={() => setShowSearch(true)} data-testid="header-search-btn" className="text-ink-soft hover:text-maroon">
              <MagnifyingGlass size={20} />
            </button>
            <Link to={verifyCta.href || "/verify"} className={VERIFY_CTA_STYLES[verifyCta.style] || VERIFY_CTA_STYLES.text} data-testid={NAV.verify}>
              <ShieldCheck size={18} weight="duotone" /> {verifyCta.label || "Verify"}
            </Link>
            {user ? (
              <>
                <Link to="/account" data-testid={NAV.account} className="text-sm text-ink hover:text-maroon flex items-center gap-1.5">
                  <User size={18} weight="duotone" /> <span className="hidden sm:inline">{user.name?.split(" ")[0] || "Account"}</span>
                </Link>
                {user.is_admin && (
                  <Link to="/admin" data-testid={NAV.admin} className="text-xs uppercase tracking-widest text-maroon border border-maroon px-2 py-1">
                    Admin
                  </Link>
                )}
                <button onClick={logout} data-testid="nav-logout" className="text-xs text-ink-muted hover:text-maroon hidden sm:inline">Logout</button>
              </>
            ) : (
              <Link to="/login" data-testid={NAV.login} className="text-sm text-ink hover:text-maroon">Login</Link>
            )}
            <button
              data-testid={NAV.cart}
              onClick={() => setShowCart(true)}
              className="relative flex items-center gap-1.5 text-sm text-ink hover:text-maroon"
            >
              <ShoppingBagOpen size={20} weight="duotone" />
              <span className="hidden sm:inline">Cart</span>
              {count > 0 && (
                <span data-testid="nav-cart-count" className="absolute -top-2 -right-3 bg-maroon text-ivory text-[10px] px-1.5 py-0.5 rounded-full">
                  {count}
                </span>
              )}
            </button>
            <button className="lg:hidden text-ink" onClick={() => setOpen(!open)} data-testid="nav-mobile-toggle">
              {open ? <X size={22} /> : <List size={22} />}
            </button>
          </div>
        </div>

        {/* Mega-menu panel */}
        {mega && (
          <div
            className="hidden lg:block absolute left-0 right-0 top-full z-50 border-t border-gold/40 shadow-2xl"
            style={{ backgroundColor: "#FBFBF9" }}
            onMouseLeave={() => setMega(null)}
            onMouseEnter={() => setMega(mega)}
          >
            <div className="mx-auto max-w-7xl px-10 py-10 grid grid-cols-[1fr_360px] gap-10">
              <div className="grid grid-cols-3 gap-10">
                {(megaNav.find((x) => x.key === mega)?.columns || []).map((col) => (
                  <div key={col.title}>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-gold-soft mb-4">{col.title}</div>
                    <ul className="space-y-2.5">
                      {col.items.map((it) => (
                        <li key={it.label}>
                          <Link to={it.href} className="text-sm text-ink-soft hover:text-maroon" onClick={() => setMega(null)}>{it.label}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="relative gold-line-strong bg-cream p-6">
                <div className="text-[10px] uppercase tracking-[0.3em] text-gold-soft">{promo.eyebrow}</div>
                <div className="font-display text-2xl text-maroon-deep mt-2 leading-tight">{promo.title}</div>
                <p className="text-sm text-ink-soft mt-3">{promo.body}</p>
                <Link
                  to={promo.cta_href || "/verify"}
                  onClick={() => setMega(null)}
                  className="mt-5 inline-flex items-center gap-2 text-sm brand-gradient text-ivory px-4 py-2"
                >
                  <ShieldCheck size={14} weight="duotone" /> {promo.cta_label}
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Mobile drawer */}
        {open && (
          <div className="lg:hidden border-t border-gold/30 bg-ivory">
            <div className="max-h-[75vh] overflow-y-auto px-6 py-4 flex flex-col gap-2">
              {megaNav.map((m) => (
                <details key={m.key} className="border-b border-gold/20 py-2">
                  <summary className="flex items-center justify-between cursor-pointer">
                    <span className="text-ink font-medium">{m.label}</span>
                    <span className="font-deva text-gold-soft text-xs">{m.hindi}</span>
                  </summary>
                  <ul className="mt-2 space-y-2 pl-1">
                    {m.columns.flatMap((c) => c.items).map((it) => (
                      <li key={it.label}><Link to={it.href} onClick={() => setOpen(false)} className="text-sm text-ink-soft">{it.label}</Link></li>
                    ))}
                  </ul>
                </details>
              ))}
              <Link to={verifyCta.href || "/verify"} onClick={() => setOpen(false)} className="mt-3 text-verified font-medium">Verify a QR →</Link>
            </div>
          </div>
        )}
        <div className="brand-gradient h-[1px] w-full" />
      </header>

      <SearchOverlay open={showSearch} onClose={() => setShowSearch(false)} />
      <CartDrawer open={showCart} onClose={() => setShowCart(false)} />
    </>
  );
}
