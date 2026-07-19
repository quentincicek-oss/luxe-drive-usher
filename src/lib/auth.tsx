import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Ctx {
  session: Session | null;
  user: User | null;
  role: "admin" | "driver" | "passenger" | null;
  loading: boolean;
  signOut: () => Promise<void>;
}
const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Ctx["role"]>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        // Defer role fetch outside the listener to avoid deadlock
        setTimeout(async () => {
          const { data } = await supabase.from("user_roles").select("role").eq("user_id", s.user.id);
          if (data && data.length > 0) {
            const r = data.map((x) => x.role);
            setRole(r.includes("admin") ? "admin" : r.includes("driver") ? "driver" : "passenger");
          } else setRole("passenger");
        }, 0);
      } else setRole(null);
    });
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthCtx.Provider value={{
      session, user: session?.user ?? null, role, loading,
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
