import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const t = localStorage.getItem("gemora_jwt");
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// ── GET response cache ────────────────────────────────────────────────────────
// The admin panel mounts a fresh route component per tab, each firing api.get on
// mount. Without a cache, every tab switch re-hit the API, so navigating
// users → dashboard → orders felt slow. This caches GET responses in memory for a
// short TTL so repeat loads (tab switches) are instant, and flushes the whole
// cache after any write so edits show up immediately. Purge manually with
// clearApiCache() (wired to the admin "Clear cache" button).
const CACHE_TTL_MS = 60_000;
const _cache = new Map(); // key -> { t: epoch_ms, response }

// Endpoints that must always be fresh — auth/session/payment flows.
const _noCache = (url = "") =>
  /(\/auth|\/otp|\/logout|\/checkout|\/mock-pay|\/razorpay|\/webhook|\/cart)/.test(url);

const _keyOf = (config) => {
  const params = config.params ? JSON.stringify(config.params) : "";
  return `${config.baseURL || ""}${config.url || ""}?${params}`;
};

export function clearApiCache() {
  _cache.clear();
}

const _baseAdapter = axios.getAdapter(axios.defaults.adapter);

api.defaults.adapter = async (config) => {
  const method = (config.method || "get").toLowerCase();
  if (method !== "get" || _noCache(config.url)) return _baseAdapter(config);

  const key = _keyOf(config);
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) {
    // Return a shallow copy so callers can't mutate the cached response.
    return { ...hit.response, cached: true };
  }
  const response = await _baseAdapter(config);
  _cache.set(key, { t: Date.now(), response });
  return response;
};

// Any successful mutation invalidates the read cache so lists refetch fresh.
api.interceptors.response.use((resp) => {
  if ((resp.config.method || "get").toLowerCase() !== "get") clearApiCache();
  return resp;
});

// Resolve a stored image reference to a browser-usable src. External images are
// saved as absolute URLs (used as-is); user uploads come back as relative
// backend paths like "/api/media/file/…" that need the backend origin prepended.
export const mediaSrc = (ref) => {
  if (!ref) return "";
  if (/^https?:\/\//i.test(ref) || ref.startsWith("data:")) return ref;
  return `${process.env.REACT_APP_BACKEND_URL || ""}${ref}`;
};

export const formatINR = (paise) => {
  if (paise == null) return "—";
  const rupees = Math.round(paise) / 100;
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

// Human-readable summary of a cart/order line's options_list — the server-resolved
// [{key,label,value,is_default}] for that line, in the product's own group order.
// e.g. "With certification · 111 Mantra Jaap".
//
// By default only non-default picks are shown: printing "Without certification · No
// Mantra Jaap" on every line is noise. Pass {all: true} for fulfilment views, where
// staff need every pick spelled out ("Loose Gemstone" matters even though it's the
// default). Returns null when there's nothing worth showing.
export const describeOptions = (optionsList, { all = false } = {}) => {
  if (!Array.isArray(optionsList)) return null;
  const parts = optionsList
    .filter((o) => (all || !o.is_default) && o.value)
    .map((o) => o.value);
  return parts.length ? parts.join(" · ") : null;
};
