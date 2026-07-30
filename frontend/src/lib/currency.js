// Region-based pricing: maps a visitor's country to the currency staff can set
// prices in from the admin panel. Anything not listed here (and India itself)
// falls back to INR/USD respectively — same fallback the backend applies when
// no price override exists for a currency.
export const CURRENCY_BY_COUNTRY = {
  // North America
  US: "USD", CA: "CAD", MX: "MXN",
  // Europe
  GB: "GBP", DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR", CH: "CHF",
  // Asia-Pacific
  AU: "AUD", JP: "JPY", SG: "SGD", KR: "KRW", MY: "MYR", NZ: "NZD", HK: "HKD", AE: "AED",
  // SAARC neighbors
  BD: "BDT", LK: "LKR", NP: "NPR", BT: "BTN", MV: "MVR",
  IN: "INR",
};

// Mirrors backend SUPPORTED_CURRENCIES (server.py) minus INR — the admin panel's
// regional-price dropdown. Keep in sync if that set changes.
export const REGION_CURRENCIES = [
  "USD", "CAD", "MXN", "GBP", "EUR", "CHF", "AUD", "JPY", "SGD",
  "KRW", "MYR", "NZD", "HKD", "AED", "BDT", "LKR", "NPR", "BTN", "MVR",
];

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

// Auto-detects the visitor's currency from their IP (client-side, no manual
// switcher). Any failure — network error, ad-blocker, localhost dev — silently
// defaults to INR, matching today's India-only behaviour.
export async function detectCurrency() {
  const cached = readCache();
  if (cached) return cached;
  let currency = "INR";
  try {
    const res = await fetch("https://ipapi.co/json/");
    const data = await res.json();
    const country = data?.country_code;
    currency = country === "IN" ? "INR" : (CURRENCY_BY_COUNTRY[country] || "USD");
  } catch (_) { /* offline/blocked — stay on INR */ }
  writeCache(currency);
  return currency;
}

export function formatPrice(paise, currency = "INR") {
  if (paise == null) return "";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(paise / 100);
}
