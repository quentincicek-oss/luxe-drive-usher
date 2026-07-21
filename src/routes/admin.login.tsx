import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
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
  const [googleBusy, setGoogleBusy] = useState(false);

  async function signInWithGoogle() {
    setGoogleBusy(true);
    try {
      const { lovable } = await import("@/integrations/lovable/index");
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw new Error((result.error as Error).message || "Google sign-in failed");
      // Auth state change + admin gate in /admin will redirect appropriately.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setGoogleBusy(false);
    }
  }

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
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={googleBusy || busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background hover:border-gold py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {googleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.9 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41 35.8 44 30.4 44 24c0-1.2-.1-2.3-.4-3.5z"/>
              </svg>
            )}
            <span>Continue with Google</span>
          </button>
          <div className="flex items-center gap-3 text-[10px] tracking-widest text-muted-foreground uppercase">
            <div className="h-px flex-1 bg-border" />
            <span>or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div>
            <label className="label-luxe">Email</label>
            <input
              type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-input px-3 py-2.5 text-sm focus:border-gold outline-none"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="label-luxe">Password</label>
              <button
                type="button"
                onClick={sendReset}
                disabled={resetBusy}
                className="text-[11px] text-gold underline disabled:opacity-50"
              >
                {resetBusy ? "Sending…" : "Forgot password?"}
              </button>
            </div>
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
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          <Link to="/admin/recover" className="text-gold underline">Lost your authenticator?</Link>
        </p>

      </div>
    </main>
  );
}
