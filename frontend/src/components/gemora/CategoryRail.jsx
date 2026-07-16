import React from "react";
import { Link } from "react-router-dom";

const TILES = [
  { key: "rudraksha", label: "Rudraksha", img: "https://images.unsplash.com/photo-1661915606983-cc9759b99343?w=200" },
  { key: "gemstone", label: "Gemstones", img: "https://images.pexels.com/photos/9953656/pexels-photo-9953656.jpeg?w=200" },
  { key: "bracelet", label: "Bracelets", img: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=200" },
  { key: "yantra", label: "Yantras", img: "https://images.unsplash.com/photo-1609619385076-36a873425636?w=200" },
  { key: "idol", label: "Idols", img: "https://images.unsplash.com/photo-1665579156897-b28f83a3fcbd?w=200" },
  { key: "prashad", label: "Prashad", img: "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=200" },
  { key: "pooja_kit", label: "Pooja Kit", img: "https://images.pexels.com/photos/6207517/pexels-photo-6207517.jpeg?w=200" },
  { key: "book", label: "Books", img: "https://images.pexels.com/photos/15286007/pexels-photo-15286007.jpeg?w=200" },
];
const MORE = [
  { to: "/shop?category=rudraksha&mukhi=5", label: "5 Mukhi", img: "https://images.unsplash.com/photo-1661915606983-cc9759b99343?w=200" },
  { to: "/shop?graha=Jupiter", label: "Pukhraj", img: "https://images.pexels.com/photos/9953656/pexels-photo-9953656.jpeg?w=200" },
  { to: "/shop?graha=Saturn", label: "Neelam", img: "https://images.unsplash.com/photo-1615655067298-b345f22e0abe?w=200" },
  { to: "/shop?graha=Sun", label: "Manik", img: "https://images.unsplash.com/photo-1544376664-80b17f09d399?w=200" },
  { to: "/shop-by-purpose", label: "Wealth", img: "https://images.pexels.com/photos/9953656/pexels-photo-9953656.jpeg?w=200" },
  { to: "/shop-by-purpose", label: "Protection", img: "https://images.unsplash.com/photo-1609619385076-36a873425636?w=200" },
  { to: "/consultation", label: "Consult", img: "https://images.pexels.com/photos/6207517/pexels-photo-6207517.jpeg?w=200" },
  { to: "/tools/carat-ratti", label: "Carat Tool", img: "https://images.unsplash.com/photo-1615655067298-b345f22e0abe?w=200" },
];

export default function CategoryRail() {
  const all = [
    ...TILES.map((t) => ({ to: `/shop?category=${t.key}`, ...t })),
    ...MORE,
  ];
  return (
    <div className="bg-cream border-y border-gold/30 py-6">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 overflow-x-auto">
        <div className="flex gap-6 md:gap-8 min-w-max justify-center">
          {all.map((t, i) => (
            <Link key={i} to={t.to} className="flex flex-col items-center gap-2 group w-16 shrink-0">
              <div className="w-16 h-16 rounded-full overflow-hidden gold-line-strong hover-lift bg-ivory">
                <img src={t.img} alt={t.label} className="w-full h-full object-cover img-hover" loading="lazy" />
              </div>
              <div className="text-[10px] text-center text-ink-soft group-hover:text-maroon uppercase tracking-wider truncate w-full">{t.label}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
