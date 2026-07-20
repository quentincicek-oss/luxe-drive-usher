import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { HarborLogo } from "@/components/HarborLogo";
import { Field } from "@/components/ui/Field";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset Password — HarborLine" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPassword,
});

// Password recovery landing route.
// - Public route (not gated by _authenticated).
// - Supabase auto-consumes the `#access_token=...&type=recovery` hash on
//   arrival and emits a PASSWORD_RECOVERY event; we listen and unlock the
//   form only for that event or when a live recovery session is present.
// - Never reveals whether an email exists (that concern lives on /auth).
// - Never logs URL fragments, tokens, or recovery links.
// - Password recovery cannot alter roles, suspension, or MFA — it only
//   calls supabase.auth.updateUser({ password }).
function ResetPassword() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");

  useEffect(() => {
    // Two entry points:
    // 1) Fresh recovery link: onAuthStateChange fires PASSWORD_RECOVERY.
    // 2) Same-tab refresh after Supabase consumed the hash: getSession
    //    returns a session with amr including "recovery".
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setAllowed(true);
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      const amr = (data.session?.user?.app_metadata as { amr?: { method: string }[] } | undefined)?.amr;
      if (amr?.some((a) => a.method === "recovery")) {
        setAllowed(true);
      }
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pwd.length < 10) return toast.error("Password must be at least 10 characters.");
    if (pwd !== pwd2) return toast.error("Passwords do not match.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;
      toast.success("Password updated. Please sign in.");
      await supabase.auth.signOut();
      nav({ to: "/auth", replace: true });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-obsidian flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="flex flex-col items-center gap-3 mb-8">
          <HarborLogo className="h-14 w-14" />
          <div className="font-display text-2xl text-gradient-gold">HarborLine</div>
        </Link>
        <div className="card-luxe p-6 sm:p-8">
          <h1 className="font-display text-2xl mb-1">Set a new password</h1>
          <p className="text-sm text-muted-foreground mb-6 flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <span>
              Password recovery cannot change your role or bypass two-factor
              authentication. If your link expired, request a new one from the
              sign-in page.
            </span>
          </p>

          {!ready ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verifying recovery link…
            </div>
          ) : !allowed ? (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                This page is only accessible from a valid password-recovery
                email. Return to sign-in to request a new link.
              </p>
              <Link to="/auth" className="btn-primary-luxe inline-flex">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field
                label="New password"
                type="password"
                required
                autoComplete="new-password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
              />
              <Field
                label="Confirm password"
                type="password"
                required
                autoComplete="new-password"
                value={pwd2}
                onChange={(e) => setPwd2(e.target.value)}
              />
              <button disabled={busy} type="submit" className="btn-primary-luxe w-full">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Update password
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
