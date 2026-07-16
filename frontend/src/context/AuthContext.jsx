import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Only probe /auth/me if we have a token to send — avoids anonymous 401 console noise.
    const hasToken = !!localStorage.getItem("gemora_jwt");
    if (!hasToken) { setUser(null); setLoading(false); return; }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (_) {
      setUser(null);
      localStorage.removeItem("gemora_jwt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loginJwt = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("gemora_jwt", data.token);
    setUser(data.user);
    return data.user;
  };

  // Firebase Google popup -> ID token -> our JWT. Replaces the Emergent OAuth
  // redirect + /auth/session exchange.
  const googleLogin = async () => {
    const { signInWithGoogle } = await import("@/lib/firebase");
    const idToken = await signInWithGoogle();
    const { data } = await api.post("/auth/google", { id_token: idToken });
    localStorage.setItem("gemora_jwt", data.token);
    setUser(data.user);
    return data.user;
  };

  const signupJwt = async (name, email, password) => {
    const { data } = await api.post("/auth/signup", { name, email, password });
    localStorage.setItem("gemora_jwt", data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (_) {}
    localStorage.removeItem("gemora_jwt");
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, loginJwt, signupJwt, googleLogin, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
