import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { HarborLogo } from "@/components/HarborLogo";
import { Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { consumeRecoveryAndResetMfa } from "@/lib/recovery.functions";

export const Route = createFileRoute("/admin/recover")({
  head: () => ({
    meta: [
      { title: "HarborLine Admin — Recover Two-Factor" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Recover,
});

/**
 * Admin MFA recovery flow.
 *
 * The admin signs in with email + password AND a single-use recovery code
 * from their originally-issued batch. On success, all TOTP factors are
 * removed server-side, and they're routed to /admin/mfa to re-enroll.
 * Rate-limited server-side (5 attempts / 10 min / user).
 */
function Recover() {
  const nav = useNavigate();
  const consume = useServerFn(consumeRecoveryAndResetMfa);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signErr) throw signErr;

      const result = await consume({ data: { code: code.trim() } });
      if (!result.ok) {
        await supabase.auth.signOut();
        throw new Error("Recovery code was not accepted.");
      }

      toast.success("Recovery accepted — please re-enroll two-factor.");
      nav({ to: "/admin/mfa", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recovery failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-obsidian px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gold/30 bg-surface/40 p-6 shadow-luxe backdrop-blur">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <HarborLogo className="h-12 w-12" />
          <div className="font-display text-lg text-gradient-gold">Recover Two-Factor</div>
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">Administrator only</div>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          Sign in with your admin password and one of the single-use recovery codes issued when you
          first enabled two-factor. On success your authenticator will be removed so you can enroll a
          new device.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email" autoComplete="email" required placeholder="Email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border/60 bg-input px-3 py-2.5 text-sm focus:border-gold outline-none"
          />
          <input
            type="password" autoComplete="current-password" required placeholder="Password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border/60 bg-input px-3 py-2.5 text-sm focus:border-gold outline-none"
          />
          <input
            type="text" autoComplete="one-time-code" required placeholder="XXXXX-XXXXX"
            value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="w-full rounded-lg border border-border/60 bg-input px-3 py-2.5 text-center font-mono text-sm tracking-widest focus:border-gold outline-none"
          />
          <button type="submit" disabled={busy} className="btn-primary-luxe w-full justify-center">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            <span>Recover access</span>
          </button>
        </form>
        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          <Link to="/admin/login" className="text-gold underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
