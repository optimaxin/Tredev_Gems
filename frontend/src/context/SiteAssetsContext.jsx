import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, API } from "@/lib/api";

const SiteAssetsCtx = createContext({ assets: {}, getAsset: (_slot, fallback) => fallback, refresh: () => {} });

const BACKEND_ORIGIN = process.env.REACT_APP_BACKEND_URL || "";

// Site-assets endpoint returns relative /api/media/file/... paths.
// This helper turns them into absolute URLs the browser can hit.
export function absolutize(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/")) return `${BACKEND_ORIGIN}${url}`;
  return url.startsWith("/") ? `${BACKEND_ORIGIN}${url}` : url;
}

// Persist the last-known slot→url map so a refresh can paint the real images on the
// FIRST render instead of showing the hardcoded fallbacks for a second and then
// swapping (the flash of default content). We store the raw (relative) response and
// absolutize on read, so it stays correct even if the backend origin changes.
const LS_KEY = "tredev_site_assets_v1";

function absolutizeMap(data) {
  const abs = {};
  Object.entries(data || {}).forEach(([k, v]) => { abs[k] = absolutize(v); });
  return abs;
}

function readCachedAssets() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? absolutizeMap(JSON.parse(raw)) : {};
  } catch (_) { return {}; }
}

// How long a first-time visitor (no cache) will wait for the real image map before
// we give up and render with defaults. Keeps a slow/unreachable API from hanging the
// page while still avoiding the placeholder→real swap in the normal case.
const FIRST_PAINT_TIMEOUT_MS = 1500;

export function SiteAssetsProvider({ children }) {
  // Lazy initialiser runs synchronously before first paint — no flash on refresh.
  const [assets, setAssets] = useState(readCachedAssets);
  // "Ready" means we may safely paint. Returning visitors (cache present) are ready
  // immediately. First-time visitors hold briefly until /site-assets resolves so a
  // shared link never shows the placeholder image and then swaps to the real one.
  const [ready, setReady] = useState(() => Object.keys(readCachedAssets()).length > 0);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/site-assets");
      setAssets(absolutizeMap(data));
      try { localStorage.setItem(LS_KEY, JSON.stringify(data || {})); } catch (_) { /* quota / private mode */ }
    } catch (_) { /* silent — keep cached values / fall back to defaults */ }
    finally { setReady(true); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Safety net: never hold the first paint longer than the timeout.
  useEffect(() => {
    if (ready) return undefined;
    const t = setTimeout(() => setReady(true), FIRST_PAINT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready]);

  const getAsset = useCallback((slot, fallback) => assets[slot] || fallback, [assets]);

  // Brief, on-brand hold on a first visit — avoids painting wrong images.
  if (!ready) return <div className="min-h-screen bg-ivory" aria-busy="true" aria-label="Loading" />;

  return (
    <SiteAssetsCtx.Provider value={{ assets, getAsset, refresh }}>
      {children}
    </SiteAssetsCtx.Provider>
  );
}

export const useSiteAssets = () => useContext(SiteAssetsCtx);
export const useSiteAsset = (slot, fallback) => {
  const { getAsset } = useSiteAssets();
  return getAsset(slot, fallback);
};
export { API };
