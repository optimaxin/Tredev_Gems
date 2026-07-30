// Mirrors backend SHIPPING_REGIONS (server.py) — keep in sync if that list changes.
// Coarse on purpose: the buyer picks their region directly at checkout, no
// country->region mapping to maintain.
export const SHIPPING_REGIONS = [
  "North America", "Europe", "Asia-Pacific",
  "SAARC / Neighboring Countries", "Rest of World",
];
