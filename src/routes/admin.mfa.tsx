import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { HarborLogo } from "@/components/HarborLogo";
import { Loader2, ShieldCheck, KeyRound, LogOut } from "lucide-react";
import { toast } from "sonner";

// Administrator TOTP MFA
// -----------------------
// - Enrollment: any signed-in admin without a verified TOTP factor.
// - Challenge:  admin with a verified TOTP factor but current AAL != aal2.
// The admin dashboard gate (src/routes/admin.tsx) routes here when needed.
//
// MFA state is derived from Supabase Auth (mfa.listFactors + getAuthenticatorAssuranceLevel).
// It is never read from localStorage, tabs, or URL parameters.
export const Route = createFileRoute("/admin/mfa")({
  head: () => ({
    meta: [
      { title: "HarborLine Admin — Two-Factor" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminMfa,
});

type Phase = "loading" | "enroll" | "challenge" | "done";

function AdminMfa() {
  const nav = useNavigate();
  const { user, role, loading, roleLoading, signOut } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");

  // Enrollment state
  const enrollingRef = useRef(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  // Redirect non-admins away; unauthenticated → login.
  useEffect(() => {
    if (loading || roleLoading) return;
    if (!user) { nav({ to: "/admin/login", replace: true }); return; }
    if (role !== "admin") {
      // Passenger / driver / null cannot use this page to gain admin.
      nav({ to: "/", replace: true });
    }
  }, [user, role, loading, roleLoading, nav]);

  // Determine phase from Supabase authoritative MFA state.
  useEffect(() => {
    if (loading || roleLoading || !user || role !== "admin") return;
    (async () => {
      const [{ data: aal }, { data: factors, error: fErr }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      if (fErr) { toast.error("Unable to load MFA state"); return; }

      const verifiedTotp = (factors?.totp ?? []).find((f) => f.status === "verified");

      if (aal?.currentLevel === "aal2") { setPhase("done"); nav({ to: "/admin", replace: true }); return; }

      if (verifiedTotp) {
        setFactorId(verifiedTotp.id);
        setPhase("challenge");
      } else {
        setPhase("enroll");
      }
    })();
  }, [user, role, loading, roleLoading, nav]);

  // Kick off TOTP enrollment once we know we're in enroll phase.
  useEffect(() => {
    if (phase !== "enroll" || enrollingRef.current) return;
    enrollingRef.current = true;
    (async () => {
      // Clean any lingering unverified factors so re-enrollment is safe.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.totp ?? []) {
        if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `HarborLine Admin ${new Date().toISOString()}`,
      });
      if (error) { toast.error(error.message); enrollingRef.current = false; return; }
      setFactorId(data.id);
      setQr(data.totp?.qr_code ?? null);
      setSecret(data.totp?.secret ?? null);
    })();
  }, [phase]);

  async function verifyEnrollment(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    try {
      const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: ch.id,
        code: code.trim(),
      });
      if (vErr) throw vErr;
      toast.success("Two-factor enabled");
      nav({ to: "/admin", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyChallenge(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    try {
      const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: ch.id,
        code: code.trim(),
      });
      if (vErr) throw vErr;
      nav({ to: "/admin", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-obsidian px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gold/30 bg-surface/40 p-6 shadow-luxe backdrop-blur">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <HarborLogo className="h-12 w-12" />
          <div className="font-display text-lg text-gradient-gold">Two-Factor Authentication</div>
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">Administrator</div>
        </div>

        {phase === "loading" && (
          <div className="grid place-items-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
          </div>
        )}

        {phase === "enroll" && (
          <>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              Scan the QR code with an authenticator app (1Password, Google Authenticator, Authy) and
              enter the 6-digit code to enable two-factor authentication. This is required before the
              admin dashboard becomes accessible.
            </p>
            {qr ? (
              <div className="mb-4 grid place-items-center rounded-xl bg-white p-3">
                <img src={qr} alt="TOTP QR code" className="h-44 w-44" />
              </div>
            ) : (
              <div className="mb-4 grid h-44 place-items-center rounded-xl border border-border/60">
                <Loader2 className="h-5 w-5 animate-spin text-gold" />
              </div>
            )}
            {secret && (
              <div className="mb-4 rounded-md border border-border/60 bg-background px-3 py-2 text-center font-mono text-[11px] tracking-widest text-muted-foreground">
                {secret}
              </div>
            )}
            <form onSubmit={verifyEnrollment} className="space-y-3">
              <input
                inputMode="numeric" pattern="[0-9]*" maxLength={6} required
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="w-full rounded-lg border border-border/60 bg-input px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em] focus:border-gold outline-none"
              />
              <button type="submit" disabled={busy || code.length !== 6} className="btn-primary-luxe w-full justify-center">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                <span>Enable two-factor</span>
              </button>
            </form>
          </>
        )}

        {phase === "challenge" && (
          <>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              Enter the 6-digit code from your authenticator app to continue to the admin dashboard.
            </p>
            <form onSubmit={verifyChallenge} className="space-y-3">
              <input
                inputMode="numeric" pattern="[0-9]*" maxLength={6} required autoFocus
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="w-full rounded-lg border border-border/60 bg-input px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em] focus:border-gold outline-none"
              />
              <button type="submit" disabled={busy || code.length !== 6} className="btn-primary-luxe w-full justify-center">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                <span>Verify &amp; continue</span>
              </button>
            </form>
          </>
        )}

        <button
          onClick={async () => { await signOut(); nav({ to: "/admin/login", replace: true }); }}
          className="mt-6 inline-flex w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-3 w-3" /> Sign out
        </button>
      </div>
    </main>
  );
}
