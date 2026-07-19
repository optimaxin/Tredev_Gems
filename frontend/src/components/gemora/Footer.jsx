import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck } from "@phosphor-icons/react";
import { api } from "@/lib/api";

// Built-in defaults — used until the admin-edited footer (Admin → Website) loads, and
// as a fallback for any field left blank.
const DEFAULT_FOOTER = {
  brand: "Tredev",
  devanagari: "रत्न · प्रमाण · परंपरा",
  description: "A first-party house for authentic spiritual products. Every serialised item carries a cryptographically signed provenance chain — a claim you can verify with a public key.",
  badge: "Ed25519-signed certificates",
  columns: [
    { title: "Shop", links: [
      { label: "Gemstones · रत्न", href: "/shop?category=gemstone" },
      { label: "Rudraksha · रुद्राक्ष", href: "/shop?category=rudraksha" },
      { label: "Bracelets", href: "/shop?category=bracelet" },
      { label: "Yantras · यंत्र", href: "/shop?category=yantra" },
      { label: "Idols · मूर्ति", href: "/shop?category=idol" },
      { label: "Temple Prashad", href: "/shop?category=prashad" },
    ]},
    { title: "Trust", links: [
      { label: "Verify a QR", href: "/verify" },
      { label: "Carat ↔ Ratti Converter", href: "/tools/carat-ratti" },
      { label: "Shop by Planet", href: "/shop-by-planet" },
      { label: "Shop by Purpose", href: "/shop-by-purpose" },
    ]},
    { title: "Company", links: [
      { label: "Book a consultation", href: "/consultation" },
      { label: "Kolkata · Mumbai · Varanasi", href: "" },
      { label: "hello@gemora.in", href: "mailto:hello@gemora.in" },
      { label: "+91 90-000-000-00", href: "" },
    ]},
  ],
  copyright: "An honest house for sacred things · Made with care in India",
};

// Internal paths use the router; external/mailto use an anchor; blank hrefs are plain
// text (e.g. an address or phone number).
function FooterLink({ label, href }) {
  if (!href) return <span>{label}</span>;
  if (href.startsWith("/")) return <Link to={href}>{label}</Link>;
  return <a href={href}>{label}</a>;
}

export default function Footer() {
  const [f, setF] = useState(DEFAULT_FOOTER);

  useEffect(() => {
    api.get("/site-content")
      .then(({ data }) => { if (data?.footer) setF({ ...DEFAULT_FOOTER, ...data.footer }); })
      .catch(() => {});
  }, []);

  const columns = f.columns?.length ? f.columns : DEFAULT_FOOTER.columns;

  return (
    <footer className="bg-cream border-t border-gold/40 mt-24 relative overflow-hidden geom-bg">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-16 grid md:grid-cols-4 gap-10">
        <div>
          <div className="font-display text-3xl text-maroon-deep">{f.brand}</div>
          {f.devanagari && <div className="font-deva text-gold-soft mt-1">{f.devanagari}</div>}
          {f.description && <p className="text-sm text-ink-soft mt-5 leading-relaxed">{f.description}</p>}
          {f.badge && (
            <div className="flex items-center gap-2 mt-5 text-verified text-sm">
              <ShieldCheck size={18} weight="duotone" /> {f.badge}
            </div>
          )}
        </div>
        {columns.map((col, i) => (
          <div key={col.title || i}>
            <div className="text-xs uppercase tracking-widest text-ink-muted">{col.title}</div>
            <ul className="mt-4 space-y-2 text-sm text-ink-soft">
              {(col.links || []).map((l, j) => (
                <li key={j}><FooterLink label={l.label} href={l.href} /></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-gold/30 py-5 text-xs text-ink-muted text-center">
        © {new Date().getFullYear()} {f.brand} · {f.copyright}
      </div>
    </footer>
  );
}
