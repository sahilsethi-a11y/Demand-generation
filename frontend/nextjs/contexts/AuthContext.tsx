"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface User {
  user_id: string;
  email: string;
  role: "admin" | "user";
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const apiBase = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

  useEffect(() => {
    fetch(`${apiBase}/api/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [apiBase]);

  const logout = useCallback(async () => {
    await fetch(`${apiBase}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
    router.push("/login");
  }, [apiBase, router]);

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
