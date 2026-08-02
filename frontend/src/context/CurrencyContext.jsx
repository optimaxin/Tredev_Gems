import React, { createContext, useContext, useEffect, useState } from "react";
import { detectCurrency } from "@/lib/currency";
import { setCurrentCurrency } from "@/lib/api";
import { loadRazorpay } from "@/lib/razorpay";
import { loadCashfree } from "@/lib/cashfree";

const CurrencyCtx = createContext({ currency: "INR" });

// Never hold the first paint longer than this waiting on ipapi.co — same safety
// net SiteAssetsProvider uses for its own first-load network call.
const FIRST_PAINT_TIMEOUT_MS = 1500;

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState("INR");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    detectCurrency().then((c) => {
      if (cancelled) return;
      setCurrentCurrency(c); // api.js reads this for every products/consultation GET
      setCurrency(c);
      setReady(true);
      // Warm the matching gateway's checkout.js now, in the background, so a later
      // "Pay" click doesn't also pay for this script fetch before its modal can open.
      (c === "INR" ? loadCashfree() : loadRazorpay()).catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ready) return undefined;
    const t = setTimeout(() => setReady(true), FIRST_PAINT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready]);

  if (!ready) return <div className="min-h-screen bg-ivory" aria-busy="true" aria-label="Loading" />;

  return <CurrencyCtx.Provider value={{ currency }}>{children}</CurrencyCtx.Provider>;
}

export const useCurrency = () => useContext(CurrencyCtx);
