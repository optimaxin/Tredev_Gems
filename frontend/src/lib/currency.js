// Region-based pricing, binary: India sees INR, everyone else sees USD (the
// price_usd field staff set alongside each product/astrologer's INR price — no
// per-country currency matrix).
const LS_KEY = "gemora_currency_v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — country rarely changes mid-session

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (raw && Date.now() - raw.t < CACHE_TTL_MS) return raw.currency;
  } catch (_) { /* ignore */ }
  return null;
}

function writeCache(currency) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ currency, t: Date.now() })); }
  catch (_) { /* quota / private mode */ }
}

// Auto-detects India-vs-not from the visitor's IP (client-side, no manual
// switcher). Any failure — network error, ad-blocker, localhost dev — silently
// defaults to INR, matching today's India-only behaviour.
export async function detectCurrency() {
  const cached = readCache();
  if (cached) return cached;
  let currency = "INR";
  try {
    const res = await fetch("https://ipapi.co/json/");
    const data = await res.json();
    currency = data?.country_code === "IN" ? "INR" : "USD";
  } catch (_) { /* offline/blocked — stay on INR */ }
  writeCache(currency);
  return currency;
}

export function formatPrice(paise, currency = "INR") {
  if (paise == null) return "";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(paise / 100);
}
