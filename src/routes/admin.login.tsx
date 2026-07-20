import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { HarborLogo } from "@/components/HarborLogo";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [
      { title: "HarborLine Admin — Sign in" },
      { name: "description", content: "HarborLine administrator sign in." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLogin,
});

function AdminLogin() {
  const { user, role, loading, roleLoading, signOut } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  async function sendReset() {
    if (!email.trim()) {
      toast.error("Enter your email above, then tap Forgot password.");
      return;
    }
    setResetBusy(true);
    try {
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } finally {
      toast.success("If an account exists for that email, a reset link has been sent.");
      setResetBusy(false);
    }
  }

  useEffect(() => {
    if (loading || roleLoading) return;
    if (user && role === "admin") nav({ to: "/admin", replace: true });
  }, [user, role, loading, roleLoading, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      // Wait a tick for role fetch, then verify admin
      setTimeout(async () => {
        const { data } = await supabase.from("user_roles").select("role").eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "");
        const roles = (data ?? []).map((r) => r.role);
        if (!roles.includes("admin")) {
          await supabase.auth.signOut();
          toast.error("This account is not authorized for the admin application.");
          setBusy(false);
          return;
        }
        nav({ to: "/admin", replace: true });
      }, 200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-obsidian px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gold/30 bg-surface/40 p-6 shadow-luxe backdrop-blur">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <HarborLogo className="h-12 w-12" />
          <div className="font-display text-lg text-gradient-gold">HarborLine Administrator</div>
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">Authorized access only</div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label-luxe">Email</label>
            <input
              type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-input px-3 py-2.5 text-sm focus:border-gold outline-none"
            />
          </div>
          <div>
            <label className="label-luxe">Password</label>
            <input
              type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-input px-3 py-2.5 text-sm focus:border-gold outline-none"
            />
          </div>
          <button
            type="submit" disabled={busy || !email || !password}
            className="btn-primary-luxe w-full justify-center"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            <span>Sign in</span>
          </button>
        </form>
        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
          Administrators are provisioned by HarborLine. There is no public sign-up.
          {user && role !== "admin" && (
            <>
              {" "}You are signed in as a non-admin account.{" "}
              <button onClick={() => signOut()} className="text-gold underline">Sign out</button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
