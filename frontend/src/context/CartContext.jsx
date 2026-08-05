import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const CartCtx = createContext(null);

const NO_COUPONS = { applied: [], total_discount: 0, free_shipping: false };

export function CartProvider({ children }) {
  const [cart, setCart] = useState({ items: [] });
  const { user } = useAuth();
  // What the SERVER says applies right now. Never a source of truth for money —
  // /checkout re-resolves everything from its own copy of the cart — but it is what
  // the buyer sees, so it has to track the cart's real contents.
  const [coupons, setCoupons] = useState(NO_COUPONS);
  const [manualCode, setManualCode] = useState("");

  const refresh = useCallback(async () => {
    // Only fetch cart once user has interacted (a gemora_anon cookie exists) or is logged in.
    const hasAnon = document.cookie.split(";").some((c) => c.trim().startsWith("gemora_anon="));
    const hasJwt = !!localStorage.getItem("gemora_jwt");
    if (!hasAnon && !hasJwt) { setCart({ items: [] }); return; }
    try {
      const { data } = await api.get("/cart");
      setCart(data || { items: [] });
    } catch (_) {
      setCart({ items: [] });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Optimistic: apply the change to `cart` immediately, then reconcile with the
  // server's authoritative response. On failure, restore the pre-mutation cart so
  // the screen never shows a state the server didn't actually accept.
  //
  // `optimisticItem` (add only) is an *approximation* — a synthesized line the
  // caller renders while the real request is in flight (price/name/image known
  // client-side, but not the server-assigned line_id or merge-with-existing-line
  // behavior). It's replaced wholesale the moment the real response lands.
  // `pooja_details` rides along for lines that chose a video Pooja Energization —
  // wearer/sankalp info the server validates and stores against the line. Undefined
  // for every other line, and dropped from the JSON body when absent.
  const add = async ({ product_id, unit_id, qty = 1, options, pooja_details, optimisticItem }) => {
    const prevCart = cart;
    if (optimisticItem) {
      const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setCart((c) => ({
        ...c,
        items: [...(c.items || []), { ...optimisticItem, line_id: tempId, product_id, unit_id, qty, pooja_details, _pending: true }],
      }));
    }
    try {
      const { data } = await api.post("/cart/add", { product_id, unit_id, qty, options, pooja_details });
      setCart(data);
      return data;
    } catch (e) {
      setCart(prevCart);
      throw e;
    }
  };

  const remove = async (line_id) => {
    const prevCart = cart;
    setCart((c) => ({ ...c, items: (c.items || []).filter((li) => li.line_id !== line_id) }));
    try {
      const { data } = await api.post(`/cart/remove/${line_id}`);
      setCart(data);
    } catch (e) {
      setCart(prevCart);
      throw e;
    }
  };

  const setQty = async (line_id, qty) => {
    const prevCart = cart;
    setCart((c) => ({
      ...c,
      items: (c.items || []).map((li) => (li.line_id === line_id ? { ...li, qty } : li)),
    }));
    try {
      const { data } = await api.post("/cart/set-qty", { line_id, qty });
      setCart(data);
      return data;
    } catch (e) {
      setCart(prevCart);
      throw e;
    }
  };

  const count = (cart.items || []).reduce((s, li) => s + (li.qty || 1), 0);
  const subtotal = (cart.items || []).reduce((s, li) => s + li.price * li.qty, 0);

  // ── Coupons ────────────────────────────────────────────────────────────────
  // Auto-apply coupons are found by the server; the only thing we send is a code
  // the buyer typed. Everything else (subtotal, product ids, eligibility) the
  // server reads from its own cart, so there is nothing here worth forging.
  const syncCoupons = useCallback(async (code) => {
    const wanted = code === undefined ? manualCode : code;
    if (!user) { setCoupons(NO_COUPONS); return NO_COUPONS; }
    if (!wanted) {
      const { data } = await api.get("/coupons/auto-apply");
      setCoupons(data);
      return data;
    }
    const { data } = await api.post("/coupons/validate", { code: wanted });
    setCoupons(data);
    setManualCode(wanted);
    return data;
  }, [user, manualCode]);

  const applyCode = useCallback((code) => syncCoupons(code.trim().toUpperCase()), [syncCoupons]);
  const removeCode = useCallback(() => { setManualCode(""); return syncCoupons(""); }, [syncCoupons]);

  // Re-check on every cart change: a coupon whose minimum is no longer met has to
  // drop off the total the buyer is looking at, not just fail later at checkout.
  const cartSignature = useMemo(
    () => (cart.items || []).map((li) => `${li.line_id}:${li.qty}`).join(",") + `|${cart.currency}`,
    [cart],
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await syncCoupons();
      } catch (_) {
        // The typed code no longer qualifies for this cart — drop it and fall back
        // to whatever still auto-applies, rather than showing a stale discount.
        if (cancelled) return;
        setManualCode("");
        try { const { data } = await api.get("/coupons/auto-apply"); if (!cancelled) setCoupons(data); }
        catch (_) { if (!cancelled) setCoupons(NO_COUPONS); }
      }
    })();
    return () => { cancelled = true; };
    // syncCoupons is intentionally excluded: it changes identity with manualCode,
    // which would re-fire this on every apply and undo the code that was just set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSignature, user]);

  const discount = coupons.total_discount || 0;

  return (
    <CartCtx.Provider value={{
      cart, refresh, add, remove, setQty, count, subtotal,
      coupons, manualCode, applyCode, removeCode, discount,
    }}>
      {children}
    </CartCtx.Provider>
  );
}

export const useCart = () => useContext(CartCtx);
