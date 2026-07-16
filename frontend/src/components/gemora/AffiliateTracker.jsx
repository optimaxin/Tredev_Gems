import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const KEY = "gemora_affiliate_ref";
const KEY_META = "gemora_affiliate_meta";
const TTL_DAYS = 30;

/** Read the currently-stored affiliate ref (or null if expired/missing). */
export function getAffiliateRef() {
  try {
    const raw = localStorage.getItem(KEY);
    const meta = JSON.parse(localStorage.getItem(KEY_META) || "null");
    if (!raw || !meta || Date.now() > meta.expires_at) {
      localStorage.removeItem(KEY);
      localStorage.removeItem(KEY_META);
      return null;
    }
    return raw;
  } catch (_) { return null; }
}

/**
 * Watches the URL for `?ref=<code>` on every route change and, if present,
 * stashes the code in localStorage for 30 days. Purchases made later will
 * attribute back to the astrologer even if the user browses other pages first.
 */
export default function AffiliateTracker() {
  const { search } = useLocation();
  useEffect(() => {
    try {
      const p = new URLSearchParams(search);
      const ref = p.get("ref");
      if (!ref) return;
      const expires_at = Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(KEY, ref);
      localStorage.setItem(KEY_META, JSON.stringify({ expires_at, first_seen: new Date().toISOString() }));
    } catch (_) { /* localStorage disabled — ignore */ }
  }, [search]);
  return null;
}
