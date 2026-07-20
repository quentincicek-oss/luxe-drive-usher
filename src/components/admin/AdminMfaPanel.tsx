import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff, KeyRound } from "lucide-react";
import { resetAdminMfa, listAdminMfaStatus } from "@/lib/mfa.functions";

// Administrator MFA recovery panel.
// - Lists administrators and whether they have a verified TOTP factor.
// - Removes ALL of a target admin's factors after explicit confirmation
//   and a sanitized reason. Server-side rules (RPC + AAL2 middleware):
//     * caller must be an admin holding an AAL2 session
//     * target must be an admin
//     * self-reset is blocked
//     * reason 4..500 chars, recorded in audit_log
// - TOTP secrets are never displayed. Removal forces the target to
//   re-enroll at next sign-in (the admin gate routes to /admin/mfa).
type Row = { user_id: string; email: string | null; hasVerifiedFactor: boolean };

export function AdminMfaPanel() {
  const list = useServerFn(listAdminMfaStatus);
  const reset = useServerFn(resetAdminMfa);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const r = await list();
      setRows(r as Row[]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not load admin MFA status.");
    } finally {
      setBusy(false);
    }
  }, [list]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function onReset(row: Row) {
    const reason = window.prompt(
      `Reset all two-factor factors for ${row.email ?? row.user_id}?\n\n` +
        `The admin will be required to re-enroll at next sign-in.\n\n` +
        `Enter the reason (recorded in the audit log):`,
    );
    if (!reason || reason.trim().length < 4) {
      toast.error("Reason is required (min 4 characters).");
      return;
    }
    if (!window.confirm(`Confirm MFA reset for ${row.email ?? row.user_id}?`)) return;
    setPending(row.user_id);
    try {
      const res = (await reset({ data: { targetUserId: row.user_id, reason: reason.trim() } })) as { removed: number; total: number; outcome: "completed" };
      toast.success(`Removed ${res.removed} of ${res.total} factor(s). Re-enrollment required at next sign-in.`);
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Reset failed";
      toast.error(msg === "aal2 required" ? "Your admin session must be verified with 2FA to perform this action." : msg);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="card-luxe p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-xl">Administrator two-factor recovery</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Removing an admin's factors forces re-enrollment at their next sign-in. Actions are audited.
          </p>
        </div>
        <button onClick={refresh} disabled={busy} className="btn-ghost-luxe text-xs">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh"}
        </button>
      </div>

      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Administrator</th>
              <th className="text-left px-4 py-3">2FA status</th>
              <th className="text-right px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !busy && (
              <tr><td colSpan={3} className="text-center py-8 text-muted-foreground">No administrators.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.user_id} className="border-t border-border/40">
                <td className="px-4 py-3">{r.email ?? r.user_id}</td>
                <td className="px-4 py-3">
                  {r.hasVerifiedFactor ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-300">
                      <ShieldCheck className="h-3.5 w-3.5" /> Enrolled
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-amber-300">
                      <ShieldOff className="h-3.5 w-3.5" /> Not enrolled
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onReset(r)}
                    disabled={!r.hasVerifiedFactor || pending === r.user_id}
                    className="btn-ghost-luxe text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {pending === r.user_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                    Reset 2FA
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
