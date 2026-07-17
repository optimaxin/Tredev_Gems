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

  const add = async ({ product_id, unit_id, qty = 1, options }) => {
    const { data } = await api.post("/cart/add", { product_id, unit_id, qty, options });
    setCart(data);
    return data;
  };

  const remove = async (line_id) => {
    const { data } = await api.post(`/cart/remove/${line_id}`);
    setCart(data);
  };

  const setQty = async (line_id, qty) => {
    const { data } = await api.post("/cart/set-qty", { line_id, qty });
    setCart(data);
    return data;
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
