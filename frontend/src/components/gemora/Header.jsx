import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { MagnifyingGlass, ShoppingBagOpen, User, List, X, ShieldCheck, CaretDown } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { NAV } from "@/constants/testIds";
import AnnouncementBar from "@/components/gemora/AnnouncementBar";
import SearchOverlay from "@/components/gemora/SearchOverlay";
import CartDrawer from "@/components/gemora/CartDrawer";
import logo from "@/assets/logo.png";

const MEGA = [
  {
    key: "rudraksha", label: "Rudraksha", hindi: "रुद्राक्ष",
    columns: [
      { title: "Shop by Mukhi", items: [
        ["1 Mukhi (Ganesh)", "/shop?category=rudraksha"],
        ["5 Mukhi", "/shop?category=rudraksha&mukhi=5"],
        ["7 Mukhi (Lakshmi)", "/shop?category=rudraksha&mukhi=7"],
        ["8 Mukhi (Ketu)", "/shop?category=rudraksha&mukhi=8"],
        ["Gauri Shankar", "/shop?category=rudraksha"],
      ]},
      { title: "By Purpose", items: [
        ["Wealth", "/shop?category=rudraksha&purpose=wealth"],
        ["Health", "/shop?category=rudraksha&purpose=health"],
        ["Protection", "/shop?category=rudraksha&purpose=protection"],
        ["Career", "/shop?category=rudraksha&purpose=career"],
      ]},
      { title: "Origin & Kavach", items: [
        ["Nepal (Original)", "/shop?category=rudraksha"],
        ["Indonesian", "/shop?category=rudraksha"],
        ["Kavach Combos", "/shop?category=rudraksha"],
      ]},
    ],
  },
  {
    key: "gemstone", label: "Gemstones", hindi: "रत्न",
    columns: [
      { title: "Navratna (nine)", items: [
        ["Yellow Sapphire (Pukhraj)", "/shop?graha=Jupiter"],
        ["Blue Sapphire (Neelam)", "/shop?graha=Saturn"],
        ["Ruby (Manik)", "/shop?graha=Sun"],
        ["Emerald (Panna)", "/shop?graha=Mercury"],
        ["Pearl (Moti)", "/shop?graha=Moon"],
        ["Red Coral (Moonga)", "/shop?graha=Mars"],
        ["Diamond (Heera)", "/shop?graha=Venus"],
        ["Hessonite (Gomed)", "/shop?graha=Rahu"],
        ["Cat's Eye (Lehsuniya)", "/shop?graha=Ketu"],
      ]},
      { title: "By Origin", items: [
        ["Ceylon", "/shop?category=gemstone"],
        ["Kashmir", "/shop?category=gemstone"],
        ["Burma", "/shop?category=gemstone"],
        ["Zambian", "/shop?category=gemstone"],
      ]},
      { title: "By Rashi", items: [
        ["Sagittarius / धनु", "/shop"], ["Capricorn / मकर", "/shop"], ["Leo / सिंह", "/shop"],
      ]},
    ],
  },
  {
    key: "bracelet", label: "Bracelets & Mala", hindi: "कड़ा · माला",
    columns: [
      { title: "Bracelets", items: [
        ["Rudraksha Bracelets", "/shop?category=bracelet"],
        ["Zodiac Bracelets", "/shop?category=bracelet"],
        ["Crystal Bracelets", "/shop?category=bracelet"],
      ]},
      { title: "Malas", items: [
        ["Rudraksha Mala (108)", "/shop?category=bracelet"],
        ["Tulsi Mala", "/shop?category=bracelet"],
        ["Sphatik Mala", "/shop?category=bracelet"],
      ]},
    ],
  },
  {
    key: "yantra", label: "Yantras & Pooja", hindi: "यंत्र · पूजा",
    columns: [
      { title: "Yantras", items: [
        ["Sri Yantra", "/shop?category=yantra"],
        ["Kuber Yantra", "/shop?category=yantra"],
        ["Navagraha Yantra", "/shop?category=yantra"],
      ]},
      { title: "Idols · मूर्ति", items: [
        ["Ganesha", "/shop?category=idol"],
        ["Krishna", "/shop?category=idol"],
        ["Devi", "/shop?category=idol"],
      ]},
      { title: "Prashad · प्रसाद", items: [
        ["Tirupati Laddu", "/shop?category=prashad"],
        ["Ayodhya Prashad", "/shop?category=prashad"],
      ]},
    ],
  },
  {
    key: "purpose", label: "Shop by Purpose", hindi: "उद्देश्य",
    columns: [
      { title: "Life goals", items: [
        ["Wealth · धन", "/shop-by-purpose"],
        ["Protection · रक्षा", "/shop-by-purpose"],
        ["Love · प्रेम", "/shop-by-purpose"],
        ["Career · करियर", "/shop-by-purpose"],
        ["Health · स्वास्थ्य", "/shop-by-purpose"],
      ]},
    ],
  },
  {
    key: "consult", label: "Consult & Tools", hindi: "परामर्श",
    columns: [
      { title: "Free tools", items: [
        ["Carat ↔ Ratti", "/tools/carat-ratti"],
      ]},
      { title: "Consult", items: [
        ["Book an Astrologer", "/consultation"],
      ]},
      { title: "Trust", items: [
        ["Verify a QR", "/verify"],
        ["The provenance chain", "/verify"],
      ]},
    ],
  },
];

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
            {MEGA.map((m) => (
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
            <Link to="/verify" className="hidden md:flex items-center gap-1.5 text-sm text-verified font-semibold" data-testid={NAV.verify}>
              <ShieldCheck size={18} weight="duotone" /> Verify
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
                {(MEGA.find((x) => x.key === mega)?.columns || []).map((col) => (
                  <div key={col.title}>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-gold-soft mb-4">{col.title}</div>
                    <ul className="space-y-2.5">
                      {col.items.map(([label, to]) => (
                        <li key={label}>
                          <Link to={to} className="text-sm text-ink-soft hover:text-maroon" onClick={() => setMega(null)}>{label}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="relative gold-line-strong bg-cream p-6">
                <div className="text-[10px] uppercase tracking-[0.3em] text-gold-soft">The Tredev promise</div>
                <div className="font-display text-2xl text-maroon-deep mt-2 leading-tight">Every item, provably real.</div>
                <p className="text-sm text-ink-soft mt-3">Serialised. Certified. Ed25519 signed. Scan the QR — verify anywhere.</p>
                <Link
                  to="/verify"
                  onClick={() => setMega(null)}
                  className="mt-5 inline-flex items-center gap-2 text-sm brand-gradient text-ivory px-4 py-2"
                >
                  <ShieldCheck size={14} weight="duotone" /> Verify a stone
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Mobile drawer */}
        {open && (
          <div className="lg:hidden border-t border-gold/30 bg-ivory">
            <div className="max-h-[75vh] overflow-y-auto px-6 py-4 flex flex-col gap-2">
              {MEGA.map((m) => (
                <details key={m.key} className="border-b border-gold/20 py-2">
                  <summary className="flex items-center justify-between cursor-pointer">
                    <span className="text-ink font-medium">{m.label}</span>
                    <span className="font-deva text-gold-soft text-xs">{m.hindi}</span>
                  </summary>
                  <ul className="mt-2 space-y-2 pl-1">
                    {m.columns.flatMap((c) => c.items).map(([label, to]) => (
                      <li key={label}><Link to={to} onClick={() => setOpen(false)} className="text-sm text-ink-soft">{label}</Link></li>
                    ))}
                  </ul>
                </details>
              ))}
              <Link to="/verify" onClick={() => setOpen(false)} className="mt-3 text-verified font-medium">Verify a QR →</Link>
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
