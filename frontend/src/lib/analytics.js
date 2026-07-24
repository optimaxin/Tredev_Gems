import posthog from "posthog-js";

const KEY = process.env.REACT_APP_POSTHOG_KEY;
let enabled = false;

export function initAnalytics() {
  if (!KEY || enabled) return;
  posthog.init(KEY, {
    api_host: process.env.REACT_APP_POSTHOG_HOST || "https://us.i.posthog.com",
    capture_pageview: false, // we capture on route change ourselves (SPA)
  });
  enabled = true;
}

export const pageview = () => enabled && posthog.capture("$pageview");
export const identify = (id, props) => enabled && id && posthog.identify(id, props);
export const reset = () => enabled && posthog.reset();
