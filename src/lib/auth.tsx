import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "admin" | "driver" | "passenger" | null;

interface Ctx {
  session: Session | null;
  user: User | null;
  role: Role;
  loading: boolean;
  roleLoading: boolean;
  signOut: () => Promise<void>;
}
const AuthCtx = createContext<Ctx | null>(null);

async function fetchRole(userId: string): Promise<{ ok: true; role: Role } | { ok: false }> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) return { ok: false }; // C6 — surface fetch failure; do NOT demote to passenger.
  if (!data || data.length === 0) return { ok: true, role: "passenger" };
  const r = data.map((x) => x.role);
  return {
    ok: true,
    role: r.includes("admin") ? "admin" : r.includes("driver") ? "driver" : "passenger",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    const applyForSession = (s: Session | null) => {
      setSession(s);
      const uid = s?.user?.id ?? null;
      if (!uid) {
        lastUserId.current = null;
        setRole(null);
        setRoleLoading(false);
        return;
      }
      if (lastUserId.current === uid) return; // avoid refetch on token refresh
      lastUserId.current = uid;
      setRoleLoading(true);
      setTimeout(async () => {
        const res = await fetchRole(uid);
        if (res.ok) {
          setRole(res.role);
        }
        // If fetch failed, KEEP the prior role (do not demote to passenger).
        setRoleLoading(false);

        // Claim any pending referral captured via /r/:code
        try {
          const raw = sessionStorage.getItem("harborline.referral");
          if (raw) {
            const { code, source } = JSON.parse(raw);
            const { claimReferral } = await import("@/lib/referrals.functions");
            try {
              await claimReferral({ data: { code, source } });
              sessionStorage.removeItem("harborline.referral");
            } catch {
              // Retain sessionStorage so a later session/network retry can claim.
            }
          }
        } catch { /* noop */ }
      }, 0);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        setSession(s);
        return;
      }
      applyForSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      applyForSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthCtx.Provider value={{
      session, user: session?.user ?? null, role, loading, roleLoading,
      signOut: async () => { await supabase.auth.signOut(); }
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
