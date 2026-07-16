import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck } from "@phosphor-icons/react";

export default function Footer() {
  return (
    <footer className="bg-cream border-t border-gold/40 mt-24 relative overflow-hidden geom-bg">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-16 grid md:grid-cols-4 gap-10">
        <div>
          <div className="font-display text-3xl text-maroon-deep">Tredev</div>
          <div className="font-deva text-gold-soft mt-1">रत्न · प्रमाण · परंपरा</div>
          <p className="text-sm text-ink-soft mt-5 leading-relaxed">
            A first-party house for authentic spiritual products. Every serialised item carries
            a cryptographically signed provenance chain — a claim you can verify with a public key.
          </p>
          <div className="flex items-center gap-2 mt-5 text-verified text-sm">
            <ShieldCheck size={18} weight="duotone" /> Ed25519-signed certificates
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-ink-muted">Shop</div>
          <ul className="mt-4 space-y-2 text-sm text-ink-soft">
            <li><Link to="/shop?category=gemstone">Gemstones · रत्न</Link></li>
            <li><Link to="/shop?category=rudraksha">Rudraksha · रुद्राक्ष</Link></li>
            <li><Link to="/shop?category=bracelet">Bracelets</Link></li>
            <li><Link to="/shop?category=yantra">Yantras · यंत्र</Link></li>
            <li><Link to="/shop?category=idol">Idols · मूर्ति</Link></li>
            <li><Link to="/shop?category=prashad">Temple Prashad</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-ink-muted">Trust</div>
          <ul className="mt-4 space-y-2 text-sm text-ink-soft">
            <li><Link to="/verify">Verify a QR</Link></li>
            <li><Link to="/tools/carat-ratti">Carat ↔ Ratti Converter</Link></li>
            <li><Link to="/shop-by-planet">Shop by Planet</Link></li>
            <li><Link to="/shop-by-purpose">Shop by Purpose</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-ink-muted">Company</div>
          <ul className="mt-4 space-y-2 text-sm text-ink-soft">
            <li><Link to="/consultation">Book a consultation</Link></li>
            <li>Kolkata · Mumbai · Varanasi</li>
            <li>hello@gemora.in</li>
            <li>+91 90-000-000-00</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-gold/30 py-5 text-xs text-ink-muted text-center">
        © {new Date().getFullYear()} Tredev · An honest house for sacred things · Made with care in India
      </div>
    </footer>
  );
}
