import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const CartCtx = createContext(null);

export function CartProvider({ children }) {
  const [cart, setCart] = useState({ items: [] });

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
  const add = async ({ product_id, unit_id, qty = 1, options, optimisticItem }) => {
    const prevCart = cart;
    if (optimisticItem) {
      const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setCart((c) => ({
        ...c,
        items: [...(c.items || []), { ...optimisticItem, line_id: tempId, product_id, unit_id, qty, _pending: true }],
      }));
    }
    try {
      const { data } = await api.post("/cart/add", { product_id, unit_id, qty, options });
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

  return (
    <CartCtx.Provider value={{ cart, refresh, add, remove, setQty, count, subtotal }}>
      {children}
    </CartCtx.Provider>
  );
}

export const useCart = () => useContext(CartCtx);
