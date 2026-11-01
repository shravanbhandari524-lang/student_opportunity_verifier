"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

const AuthContext = createContext({
  user: null,
  authConfigured: false,
  loading: false,
  refresh: () => {},
  logout: async () => {},
  deleteAccount: async () => {},
});

/**
 * Authentication context provider.
 * Seeded with server-resolved initialUser and authConfigured to eliminate client-side flicker.
 */
export function AuthProvider({ initialUser = null, authConfigured = false, children }) {
  const [user, setUser] = useState(initialUser);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      setUser(null);
      window.location.href = "/";
    } catch {
      window.location.href = "/";
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    const res = await fetch("/api/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      setUser(null);
      window.location.href = "/";
    } else {
      throw new Error("Failed to delete account");
    }
  }, []);

  return React.createElement(
    AuthContext.Provider,
    {
      value: {
        user,
        authConfigured,
        loading,
        refresh,
        logout,
        deleteAccount,
      },
    },
    children
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
