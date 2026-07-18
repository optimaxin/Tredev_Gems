import React from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";

/**
 * Shared admin search input. Controlled — pass `value` and `onChange(nextString)`.
 * Used across every admin/staff list screen for a consistent look and behaviour.
 */
export default function SearchBar({ value, onChange, placeholder = "Search…", className = "", testId }) {
  return (
    <div className={`relative ${className}`}>
      <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testId}
        className="w-full gold-line pl-9 pr-9 py-2.5 bg-ivory outline-none focus:border-maroon"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-maroon p-1"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// Case-insensitive "does any of these fields contain the query" helper for filters.
export const matchesQuery = (query, fields) => {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  return fields.filter((f) => f != null).some((f) => String(f).toLowerCase().includes(q));
};
