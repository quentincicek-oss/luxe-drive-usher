import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  provisionUser,
  resendInvitation,
  setUserSuspension,
  listManagedUsers,
  convertUserRole,
} from "@/lib/provisioning.functions";
import { supabase } from "@/integrations/supabase/client";

interface ManagedUser {
  user_id: string;
  email: string | null;
  full_name: string | null;
  preferred_language: string | null;
  is_suspended: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
  is_test_account: boolean;
  created_at: string;
  role: string | null;
  driver_employee_id: string | null;
  driver_employment_status: string | null;
  driver_availability_status: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  entity_id: string | null;
  actor_email: string | null;
  reason: string | null;
  created_at: string;
  next: any;
}

const ACCOUNT_TYPES = ["driver", "admin", "passenger"] as const;

export function UsersPanel() {
  const list = useServerFn(listManagedUsers);
  const provision = useServerFn(provisionUser);
  const resend = useServerFn(resendInvitation);
  const suspend = useServerFn(setUserSuspension);
  const convert = useServerFn(convertUserRole);

  const [rows, setRows] = useState<ManagedUser[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<"all" | "admin" | "driver" | "passenger" | "suspended">("all");
  // Per-user resend cooldown expressed as an "available at" timestamp (ms).
  const [cooldownUntil, setCooldownUntil] = useState<Record<string, number>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());
  const tickRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const data = await list();
      setRows((data ?? []) as ManagedUser[]);
      const { data: a } = await supabase
        .from("audit_log")
        .select("id, action, entity_id, actor_email, reason, created_at, next")
        .in("action", [
          "user.provisioned",
          "user.suspended",
          "user.reactivated",
          "user.invitation_resent",
          "user.provisioning_failed",
          "user.role_converted",
        ])
        .order("created_at", { ascending: false })
        .limit(50);
      setAudit((a ?? []) as AuditRow[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load users");
    } finally {
      setBusy(false);
    }
  }, [list]);

  useEffect(() => { refresh(); }, [refresh]);

  // 1-second ticker only while any cooldown is active, for button countdowns.
  useEffect(() => {
    const hasActive = Object.values(cooldownUntil).some((t) => t > Date.now());
    if (!hasActive) {
      if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    if (tickRef.current) return;
    tickRef.current = window.setInterval(() => setNowTick(Date.now()), 1000) as unknown as number;
    return () => {
      if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [cooldownUntil, nowTick]);

  const filtered = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "suspended") return r.is_suspended;
    return r.role === filter;
  });

  function remainingCooldown(userId: string): number {
    const t = cooldownUntil[userId];
    if (!t) return 0;
    return Math.max(0, Math.ceil((t - nowTick) / 1000));
  }

  async function handleResend(id: string) {
    if (remainingCooldown(id) > 0) return;
    try {
      const res: any = await resend({ data: { userId: id } });
      if (res?.cooldown) {
        setCooldownUntil((m) => ({ ...m, [id]: Date.now() + (res.retryAfterSeconds ?? 300) * 1000 }));
        toast.error(res.message ?? "Please wait before retrying.");
        return;
      }
      setCooldownUntil((m) => ({ ...m, [id]: Date.now() + (res?.retryAfterSeconds ?? 300) * 1000 }));
      toast.success("Invitation resent");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Resend failed");
    }
  }

  async function handleSuspend(id: string, currentlySuspended: boolean) {
    const reason = currentlySuspended
      ? undefined
      : window.prompt("Reason for suspension (visible in audit log):") ?? undefined;
    if (!currentlySuspended && !reason) return;
    try {
      await suspend({ data: { userId: id, suspend: !currentlySuspended, reason } });
      toast.success(currentlySuspended ? "Account reactivated" : "Account suspended");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    }
  }

  async function handleConvert(user: ManagedUser) {
    if (!user.role) return;
    const nextRoleRaw = window.prompt(
      `Convert account ${user.email}\nCurrent role: ${user.role}\n\nEnter NEW role (admin / driver / passenger):`,
    );
    const nextRole = (nextRoleRaw ?? "").trim().toLowerCase();
    if (!["admin", "driver", "passenger"].includes(nextRole)) return;
    if (nextRole === user.role) { toast.error("Already has that role"); return; }
    const reason = window.prompt("Reason for conversion (min 4 chars, visible in audit log):");
    if (!reason || reason.trim().length < 4) return;
    let driver: any = undefined;
    if (nextRole === "driver") {
      const employeeId = window.prompt("Employee ID for new driver profile (e.g. HL-D-002):");
      if (!employeeId || !employeeId.trim()) return;
      driver = {
        employeeId: employeeId.trim().toUpperCase(),
        fullName: user.full_name || user.email || "Driver",
        email: user.email ?? undefined,
      };
    }
    const confirmed = window.confirm(
      `You are about to convert ${user.email} from "${user.role}" to "${nextRole}". This writes an atomic user.role_converted audit event and cannot be undone by simply provisioning again. Continue?`,
    );
    if (!confirmed) return;
    try {
      await convert({
        data: {
          userId: user.user_id,
          newRole: nextRole as any,
          reason: reason.trim(),
          confirmed: true as const,
          driver,
        },
      });
      toast.success(`Converted to ${nextRole}`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Conversion failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h3 className="font-display text-xl">Internal user provisioning</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Drivers and administrators are provisioned here. They cannot self-register or assign roles to themselves.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(["all", "admin", "driver", "passenger", "suspended"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={
                "px-3 py-1.5 text-xs rounded border transition " +
                (filter === k
                  ? "border-gold text-gold bg-gold/10"
                  : "border-border/60 text-muted-foreground hover:text-foreground")
              }
            >
              {k}
            </button>
          ))}
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 text-sm rounded bg-gold text-obsidian font-medium hover:opacity-90"
          >
            {showForm ? "Close" : "Provision user"}
          </button>
        </div>
      </div>

      {showForm && (
        <ProvisionForm
          onSubmit={async (payload) => {
            try {
              const r = await provision({ data: payload as any });
              toast.success(
                r.invited
                  ? `Invitation sent to ${payload.email}`
                  : `Account updated for ${payload.email}`,
              );
              setShowForm(false);
              refresh();
            } catch (e: any) {
              toast.error(e?.message ?? "Provisioning failed");
            }
          }}
        />
      )}

      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Name / Email</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Driver</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Created</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {busy && (
              <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">Loading…</td></tr>
            )}
            {!busy && filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No users match this filter.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.user_id} className="border-t border-border/40">
                <td className="px-4 py-3">
                  <div className="font-medium">{r.full_name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                  {r.is_test_account && (
                    <span className="mt-1 inline-block text-[10px] uppercase tracking-wider text-gold border border-gold/40 rounded px-1.5 py-0.5">
                      Test
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 capitalize">{r.role ?? "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {r.driver_employee_id ? (
                    <>
                      <div>{r.driver_employee_id}</div>
                      <div className="text-muted-foreground">
                        {r.driver_employment_status} · {r.driver_availability_status}
                      </div>
                    </>
                  ) : "—"}
                </td>
                <td className="px-4 py-3">
                  {r.is_suspended ? (
                    <span className="text-xs text-rose-400">
                      Suspended
                      {r.suspended_reason ? ` · ${r.suspended_reason}` : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-emerald-400">Active</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => handleResend(r.user_id)}
                    className="text-xs px-2.5 py-1 rounded border border-border/60 hover:border-gold hover:text-gold transition"
                  >
                    Resend invite
                  </button>
                  <button
                    onClick={() => handleSuspend(r.user_id, r.is_suspended)}
                    className={
                      "text-xs px-2.5 py-1 rounded border transition " +
                      (r.is_suspended
                        ? "border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
                        : "border-rose-500/50 text-rose-400 hover:bg-rose-500/10")
                    }
                  >
                    {r.is_suspended ? "Reactivate" : "Suspend"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h4 className="font-display text-lg mb-2">Provisioning audit history</h4>
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">When</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3">Actor</th>
                <th className="text-left px-4 py-3">Target</th>
                <th className="text-left px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No provisioning events yet.</td></tr>
              )}
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-border/40">
                  <td className="px-4 py-2 text-xs tabular-nums text-muted-foreground">{new Date(a.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs">{a.action}</td>
                  <td className="px-4 py-2 text-xs">{a.actor_email ?? "—"}</td>
                  <td className="px-4 py-2 text-xs font-mono truncate max-w-[220px]">{a.entity_id ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{a.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProvisionForm({ onSubmit }: { onSubmit: (payload: {
  accountType: "admin" | "driver" | "passenger";
  email: string; firstName: string; lastName: string;
  phone?: string; preferredLanguage?: string;
  employeeId?: string; isTestAccount?: boolean;
  invitationMessage?: string;
}) => void | Promise<void> }) {
  const [accountType, setAccountType] = useState<"admin" | "driver" | "passenger">("driver");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredLanguage, setLang] = useState("en");
  const [employeeId, setEmployeeId] = useState("");
  const [isTestAccount, setIsTest] = useState(false);
  const [invitationMessage, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (accountType === "driver" && !employeeId.trim()) {
          toast.error("Employee ID is required for drivers");
          return;
        }
        setSubmitting(true);
        try {
          await onSubmit({
            accountType,
            email: email.trim().toLowerCase(),
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phone: phone.trim() || undefined,
            preferredLanguage,
            employeeId: employeeId.trim() || undefined,
            isTestAccount,
            invitationMessage: invitationMessage.trim() || undefined,
          });
        } finally {
          setSubmitting(false);
        }
      }}
      className="rounded-lg border border-gold/30 bg-surface/40 p-5 space-y-4"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Account type">
          <select value={accountType} onChange={(e) => setAccountType(e.target.value as any)} className="input">
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Email"><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" /></Field>
        <Field label="Preferred language">
          <select value={preferredLanguage} onChange={(e) => setLang(e.target.value)} className="input">
            {["en","tr","es","pt","zh","it"].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label="First name"><input required value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input" /></Field>
        <Field label="Last name"><input required value={lastName} onChange={(e) => setLastName(e.target.value)} className="input" /></Field>
        <Field label="Phone (optional)"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" /></Field>
        {accountType === "driver" && (
          <Field label="Employee ID (required)">
            <input required value={employeeId} onChange={(e) => setEmployeeId(e.target.value.toUpperCase())} placeholder="e.g. HL-D-001" className="input" />
          </Field>
        )}
        <Field label="Test account">
          <label className="inline-flex items-center gap-2 mt-2 text-sm">
            <input type="checkbox" checked={isTestAccount} onChange={(e) => setIsTest(e.target.checked)} />
            Mark as internal test account
          </label>
        </Field>
      </div>
      <Field label="Invitation note (optional, stored in metadata)">
        <textarea value={invitationMessage} onChange={(e) => setNote(e.target.value)} rows={2} className="input" />
      </Field>
      <div className="flex items-center justify-end gap-3 pt-1">
        <button type="submit" disabled={submitting}
          className="px-5 py-2.5 rounded bg-gold text-obsidian font-medium disabled:opacity-60 hover:opacity-90">
          {submitting ? "Sending…" : "Send invitation"}
        </button>
      </div>
      <style>{`.input{width:100%;background:hsl(var(--input));border:1px solid hsl(var(--border));border-radius:8px;padding:0.55rem 0.75rem;font-size:0.875rem;color:hsl(var(--foreground))}`}</style>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</span>
      {children}
    </label>
  );
}
