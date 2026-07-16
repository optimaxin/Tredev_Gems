import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";

const SUGGESTIONS = [
  { q: "pukhraj", label: "Pukhraj · Yellow Sapphire" },
  { q: "neelam", label: "Neelam · Blue Sapphire" },
  { q: "manik", label: "Manik · Ruby" },
  { q: "moonga", label: "Moonga · Red Coral" },
  { q: "panna", label: "Panna · Emerald" },
  { q: "5 mukhi", label: "5 Mukhi Rudraksha" },
  { q: "sri yantra", label: "Sri Yantra" },
  { q: "prashad", label: "Temple Prashad" },
];

export default function SearchOverlay({ open, onClose }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else { setQ(""); setResults([]); }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/products?q=${encodeURIComponent(q)}&limit=6`).then((r) => setResults(r.data)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const suggestions = useMemo(() => {
    if (!q) return SUGGESTIONS.slice(0, 6);
    return SUGGESTIONS.filter((s) => s.q.includes(q.toLowerCase()) || s.label.toLowerCase().includes(q.toLowerCase())).slice(0, 4);
  }, [q]);

  const submit = (e) => {
    e.preventDefault();
    if (q.trim()) { onClose(); nav(`/shop?q=${encodeURIComponent(q)}`); }
  };

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      style={{ transition: "opacity 180ms ease" }}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-maroon-deep/60 backdrop-blur-md" onClick={onClose} />
      <div className={`relative mx-auto mt-20 max-w-3xl bg-ivory border border-gold-soft/60 ${open ? "translate-y-0" : "-translate-y-4"}`} style={{ transition: "transform 220ms ease" }}>
        <form onSubmit={submit} className="flex items-center gap-3 p-5 border-b border-gold/30">
          <MagnifyingGlass size={20} className="text-ink-muted" />
          <input
            ref={inputRef}
            data-testid="search-overlay-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Try 'pukhraj', 'neelam', '5 mukhi'…"
            className="flex-1 bg-transparent outline-none text-lg placeholder:text-ink-muted"
          />
          <button type="button" onClick={onClose} className="text-ink-muted hover:text-maroon"><X size={18} /></button>
        </form>
        <div className="max-h-[60vh] overflow-y-auto p-5">
          {results.length > 0 ? (
            <>
              <div className="text-[10px] uppercase tracking-[0.3em] text-ink-muted mb-3">Products</div>
              <div className="space-y-2">
                {results.map((p) => (
                  <Link
                    key={p.product_id}
                    to={`/product/${p.slug}`}
                    onClick={onClose}
                    className="flex items-center gap-4 p-2 hover:bg-cream"
                  >
                    <div className="w-14 h-14 gold-line overflow-hidden shrink-0">
                      {p.images?.[0] && <img src={p.images[0]} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-serifd text-base truncate">{p.name}</div>
                      {p.devanagari_name && <div className="font-deva text-xs text-gold-soft">{p.devanagari_name}</div>}
                    </div>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-[0.3em] text-ink-muted mb-3">Popular searches · वर्नाकुलर</div>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s.q}
                    onClick={() => setQ(s.q)}
                    className="text-sm px-3 py-1.5 border border-gold/40 hover:border-maroon hover:text-maroon"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
