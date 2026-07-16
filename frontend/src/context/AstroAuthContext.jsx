import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/lib/api";

// Separate axios instance for astrologer-side routes — uses its own JWT bucket.
export const apiAstro = axios.create({ baseURL: API, withCredentials: true });
apiAstro.interceptors.request.use((config) => {
  const t = localStorage.getItem("gemora_astro_jwt");
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

const AstroCtx = createContext(null);

export function AstroAuthProvider({ children }) {
  const [astro, setAstro] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const t = localStorage.getItem("gemora_astro_jwt");
    if (!t) { setAstro(null); setLoading(false); return; }
    try {
      const { data } = await apiAstro.get("/astrologer/me");
      setAstro(data);
    } catch (_) {
      localStorage.removeItem("gemora_astro_jwt");
      setAstro(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => {
    const { data } = await apiAstro.post("/astrologer/auth/login", { email, password });
    localStorage.setItem("gemora_astro_jwt", data.token);
    setAstro(data.astrologer);
    return data.astrologer;
  };

  const setPassword = async (token, password) => {
    const { data } = await apiAstro.post("/astrologer/auth/set-password", { token, password });
    localStorage.setItem("gemora_astro_jwt", data.token);
    setAstro(data.astrologer);
    return data.astrologer;
  };

  const logout = () => {
    localStorage.removeItem("gemora_astro_jwt");
    setAstro(null);
  };

  return (
    <AstroCtx.Provider value={{ astro, loading, login, setPassword, logout, refresh }}>
      {children}
    </AstroCtx.Provider>
  );
}

export const useAstroAuth = () => useContext(AstroCtx);
