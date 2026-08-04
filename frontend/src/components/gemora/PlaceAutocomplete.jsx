import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { MapPin } from "@phosphor-icons/react";

/**
 * Place search for "place of birth" style fields.
 *
 * Calls our own /geo/places, which proxies Amazon Location server-side — the API
 * key is never in the bundle or the Network tab (see backend/geo.py).
 *
 * onChange(label, coords) fires on every keystroke. `coords` is {lat, lon} only when
 * the user picked a suggestion, and null when they typed freely: a birth chart needs
 * real coordinates, so the caller must be able to tell a resolved place from raw text
 * rather than silently treating them as equivalent.
 */
export default function PlaceAutocomplete({
  value, onChange, placeholder = "Start typing a city…", className = "",
  country, testId = "place-autocomplete", inputProps = {},
}) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  // Set when the user picks a suggestion; cleared as soon as they type again, so a
  // stale lat/lon can never stay attached to an edited place name.
  const pickedRef = useRef("");

  useEffect(() => {
    const onDocClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const q = (value || "").trim();
    // Matches the server's own floor; below it every query matches half the planet.
    if (q.length < 3 || q === pickedRef.current) { setResults([]); return undefined; }
    let cancelled = false;
    setLoading(true);
    // Debounced — each miss on the server costs a paid AWS lookup.
    const t = setTimeout(() => {
      api.get("/geo/places", { params: { q, ...(country ? { country } : {}) } })
        .then(({ data }) => {
          if (cancelled) return;
          setResults(data?.results || []);
          setOpen((data?.results || []).length > 0);
        })
        .catch(() => { if (!cancelled) setResults([]); })   // silent: free text still works
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value, country]);

  const pick = (r) => {
    pickedRef.current = r.label;
    setOpen(false);
    setResults([]);
    onChange(r.label, { lat: r.lat, lon: r.lon });
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        value={value || ""}
        onChange={(e) => { pickedRef.current = ""; onChange(e.target.value, null); }}
        onFocus={() => results.length && setOpen(true)}
        placeholder={placeholder}
        data-testid={testId}
        autoComplete="off"
        className={className}
        {...inputProps}
      />
      {loading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-ink-muted">…</span>}
      {open && results.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 gold-line bg-ivory max-h-56 overflow-y-auto shadow-lg" data-testid={`${testId}-results`}>
          {results.map((r, i) => (
            <li key={`${r.label}-${i}`}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-cream flex items-start gap-2"
              >
                <MapPin size={13} weight="duotone" className="text-maroon shrink-0 mt-0.5" />
                <span className="min-w-0">{r.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
