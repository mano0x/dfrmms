"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, api } from "./api";
import type { Role } from "./maintenance";

export type AuthUser = {
  uid: string;
  email: string;
  name: string;
  role: Role;
  dormitory: string | null;
  roomNumber: string | null;
  specialization: string | null;
};

interface AuthContextType {
  user: AuthUser | null;
  role: Role | null;
  loading: boolean;
  /** Ask the server again who is signed in (after sign-in, for example). */
  refresh: () => Promise<AuthUser | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  refresh: async () => null,
  signOut: async () => {},
});

/**
 * Who is signed in. The answer always comes from the server (/api/auth/me),
 * which reads the httpOnly session cookie; the role shown here is only for
 * choosing what to display - every action is authorised again on the server.
 */
/**
 * Ask the server who is signed in. When the server answers that it could
 * not check the session just now (503), ask once more after a moment,
 * instead of treating a signed-in person as signed out.
 */
async function whoIsSignedIn(): Promise<AuthUser | null> {
  try {
    return (await api<{ user: AuthUser | null }>("/api/auth/me")).user;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 503) throw err;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return (await api<{ user: AuthUser | null }>("/api/auth/me")).user;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const current = await whoIsSignedIn();
      setUser(current);
      return current;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  }, []);

  // Ask the server once, when the application loads.
  useEffect(() => {
    let active = true;
    whoIsSignedIn()
      .then((current) => { if (active) setUser(current); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, role: user?.role ?? null, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
