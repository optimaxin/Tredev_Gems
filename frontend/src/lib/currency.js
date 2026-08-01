// Region-based pricing, binary: India sees INR, everyone else sees USD (the
// price_usd field staff set alongside each product/astrologer's INR price — no
// per-country currency matrix).
const LS_KEY = "gemora_geo_v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — country rarely changes mid-session

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (raw && Date.now() - raw.t < CACHE_TTL_MS) return raw.country;
  } catch (_) { /* ignore */ }
  return null;
}

function writeCache(country) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ country, t: Date.now() })); }
  catch (_) { /* quota / private mode */ }
}

// Auto-detects the visitor's country from their IP (client-side, no manual
// switcher). Any failure — network error, ad-blocker, localhost dev — silently
// falls back to India, matching this store's primary market. Shared by
// detectCurrency() and PhoneVerify's country-code picker, so both draw from
// the same single IP lookup/cache instead of firing it twice per page load.
export async function detectCountry() {
  const cached = readCache();
  if (cached) return cached;
  let country = "IN";
  try {
    const res = await fetch("https://ipapi.co/json/");
    const data = await res.json();
    if (data?.country_code) country = data.country_code;
  } catch (_) { /* offline/blocked — stay on IN */ }
  writeCache(country);
  return country;
}

export async function detectCurrency() {
  const country = await detectCountry();
  return country === "IN" ? "INR" : "USD";
}

export function formatPrice(paise, currency = "INR") {
  if (paise == null) return "";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(paise / 100);
}
