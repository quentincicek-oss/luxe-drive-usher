import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  adminListCancellationPolicies,
  adminCreateCancellationPolicy,
  adminCreateCancellationPolicyVersion,
  adminActivateCancellationPolicy,
  adminDeactivateCancellationPolicy,
  adminListNoShowPolicies,
  adminCreateNoShowPolicy,
  adminCreateNoShowPolicyVersion,
  adminActivateNoShowPolicy,
  adminDeactivateNoShowPolicy,
} from "@/lib/policies.functions";
import { SkeletonLines } from "@/components/ui/loading";
import { AlertTriangle, CheckCircle2, PauseCircle, PlusCircle, ScrollText } from "lucide-react";

type FeeType = "fixed" | "percentage" | "full_fare" | "none";
type ServiceType = "standard" | "airport";

type CancellationPolicy = {
  id: string;
  policy_key: string;
  version: number;
  name: string;
  service_type: ServiceType;
  free_cancellation_enabled: boolean;
  free_cancellation_cutoff_hours: number;
  late_cancellation_enabled: boolean;
  fee_type: FeeType;
  fee_fixed_cents: number | null;
  fee_percent_bps: number | null;
  fee_cap_cents: number | null;
  allow_cancellation_inside_cutoff: boolean;
  admin_review_required: boolean;
  customer_summary: string;
  internal_notes: string | null;
  effective_at: string;
  expires_at: string | null;
  active: boolean;
  created_at: string;
};

type NoShowPolicy = {
  id: string;
  policy_key: string;
  version: number;
  name: string;
  service_type: ServiceType;
  no_show_enabled: boolean;
  min_wait_seconds: number;
  required_contact_attempts: number;
  fee_type: FeeType;
  fee_fixed_cents: number | null;
  fee_percent_bps: number | null;
  fee_cap_cents: number | null;
  automatic_charge_enabled: boolean;
  admin_review_required: boolean;
  customer_summary: string;
  internal_notes: string | null;
  effective_at: string;
  expires_at: string | null;
  active: boolean;
  created_at: string;
};

const feeTypeLabel = (t: FeeType) =>
  ({ fixed: "Fixed", percentage: "Percentage", full_fare: "Full fare", none: "No fee" })[t];

function fmtFee(p: { fee_type: FeeType; fee_fixed_cents: number | null; fee_percent_bps: number | null; fee_cap_cents: number | null }) {
  switch (p.fee_type) {
    case "fixed": return `$${((p.fee_fixed_cents ?? 0) / 100).toFixed(2)}`;
    case "percentage": return `${((p.fee_percent_bps ?? 0) / 100).toFixed(2)}%`;
    case "full_fare": return "Full fare";
    case "none": return "No fee";
  }
}

function fmtCap(cents: number | null) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

const StatusPill = ({ active }: { active: boolean }) => (
  <span
    className={
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest " +
      (active
        ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/30"
        : "bg-muted/40 text-muted-foreground ring-1 ring-inset ring-border/60")
    }
  >
    {active ? "Active" : "Inactive"}
  </span>
);

/* --------- Grouping helpers --------- */
function groupByKeyService<T extends { policy_key: string; service_type: ServiceType; version: number }>(rows: T[]) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = `${r.policy_key}::${r.service_type}`;
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  for (const [, arr] of m) arr.sort((a, b) => b.version - a.version);
  return m;
}

/* --------- Confirm dialog --------- */
function ConfirmDialog({
  open, title, message, confirmLabel, onConfirm, onCancel, destructive,
}: {
  open: boolean; title: string; message: string; confirmLabel: string;
  onConfirm: (reason: string) => void; onCancel: () => void; destructive?: boolean;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (!open) setReason(""); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-xl border border-border/60 bg-background p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className={"h-5 w-5 mt-0.5 " + (destructive ? "text-red-400" : "text-gold")} />
          <div className="min-w-0">
            <h3 className="font-display text-lg">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
        <label className="mt-4 block text-xs uppercase tracking-widest text-muted-foreground">Reason (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2 text-sm"
          placeholder="Recorded in the audit log"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost-luxe">Cancel</button>
          <button
            onClick={() => onConfirm(reason.trim())}
            className={destructive ? "btn-luxe-outline text-red-300 border-red-500/40" : "btn-luxe"}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------- Cancellation editor (create initial or new version) --------- */
type CancelFormMode = { kind: "create" } | { kind: "version"; policy_key: string; from: CancellationPolicy };

function CancellationEditor({
  mode, onClose, onSaved,
}: { mode: CancelFormMode; onClose: () => void; onSaved: () => void }) {
  const initial = mode.kind === "version" ? mode.from : null;
  const [form, setForm] = useState({
    policy_key: initial?.policy_key ?? "",
    name: initial?.name ?? "",
    service_type: (initial?.service_type ?? "standard") as ServiceType,
    free_cancellation_enabled: initial?.free_cancellation_enabled ?? true,
    free_cancellation_cutoff_hours: initial?.free_cancellation_cutoff_hours ?? 24,
    late_cancellation_enabled: initial?.late_cancellation_enabled ?? true,
    fee_type: (initial?.fee_type ?? "none") as FeeType,
    fee_fixed_dollars: initial?.fee_fixed_cents != null ? (initial.fee_fixed_cents / 100).toString() : "",
    fee_percent: initial?.fee_percent_bps != null ? (initial.fee_percent_bps / 100).toString() : "",
    fee_cap_dollars: initial?.fee_cap_cents != null ? (initial.fee_cap_cents / 100).toString() : "",
    allow_cancellation_inside_cutoff: initial?.allow_cancellation_inside_cutoff ?? true,
    admin_review_required: initial?.admin_review_required ?? true,
    customer_summary: initial?.customer_summary ?? "",
    internal_notes: initial?.internal_notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        service_type: form.service_type,
        free_cancellation_enabled: form.free_cancellation_enabled,
        free_cancellation_cutoff_hours: Number(form.free_cancellation_cutoff_hours) || 0,
        late_cancellation_enabled: form.late_cancellation_enabled,
        fee_type: form.fee_type,
        fee_fixed_cents:
          form.fee_type === "fixed" && form.fee_fixed_dollars !== ""
            ? Math.round(Number(form.fee_fixed_dollars) * 100)
            : null,
        fee_percent_bps:
          form.fee_type === "percentage" && form.fee_percent !== ""
            ? Math.round(Number(form.fee_percent) * 100)
            : null,
        fee_cap_cents:
          form.fee_type !== "none" && form.fee_cap_dollars !== ""
            ? Math.round(Number(form.fee_cap_dollars) * 100)
            : null,
        allow_cancellation_inside_cutoff: form.allow_cancellation_inside_cutoff,
        admin_review_required: form.admin_review_required,
        customer_summary: form.customer_summary.trim(),
        internal_notes: form.internal_notes.trim() || null,
      };
      if (mode.kind === "create") {
        if (!form.policy_key.trim()) throw new Error("Policy key is required.");
        await adminCreateCancellationPolicy({
          data: { payload: { ...payload, policy_key: form.policy_key.trim() } },
        });
      } else {
        await adminCreateCancellationPolicyVersion({
          data: { policy_key: mode.policy_key, payload },
        });
      }
      toast.success("Draft policy version created (inactive).");
      onSaved();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 overflow-y-auto" role="dialog" aria-modal>
      <div className="w-full max-w-2xl my-8 rounded-xl border border-border/60 bg-background p-5 shadow-2xl">
        <h3 className="font-display text-lg mb-3">
          {mode.kind === "create" ? "New cancellation policy" : `New version of “${mode.policy_key}”`}
        </h3>
        {error && <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {mode.kind === "create" && (
            <label className="text-sm sm:col-span-2">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Policy key</span>
              <input
                value={form.policy_key}
                onChange={(e) => setForm({ ...form, policy_key: e.target.value })}
                className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2"
                placeholder="e.g. standard"
                required
              />
            </label>
          )}
          <label className="text-sm sm:col-span-2">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" required />
          </label>
          <label className="text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Service type</span>
            <select value={form.service_type}
              onChange={(e) => setForm({ ...form, service_type: e.target.value as ServiceType })}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2">
              <option value="standard">Standard</option>
              <option value="airport">Airport</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Free cancellation cutoff (hours)</span>
            <input type="number" min={0} value={form.free_cancellation_cutoff_hours}
              onChange={(e) => setForm({ ...form, free_cancellation_cutoff_hours: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
          </label>
          <label className="text-sm flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={form.free_cancellation_enabled}
              onChange={(e) => setForm({ ...form, free_cancellation_enabled: e.target.checked })} />
            Free cancellation is offered before the cutoff.
          </label>
          <label className="text-sm flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={form.late_cancellation_enabled}
              onChange={(e) => setForm({ ...form, late_cancellation_enabled: e.target.checked })} />
            Late cancellation (inside cutoff) is allowed.
          </label>
          <label className="text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Fee type</span>
            <select value={form.fee_type}
              onChange={(e) => setForm({ ...form, fee_type: e.target.value as FeeType })}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2">
              <option value="none">No fee</option>
              <option value="fixed">Fixed</option>
              <option value="percentage">Percentage</option>
              <option value="full_fare">Full fare</option>
            </select>
          </label>
          {form.fee_type === "fixed" && (
            <label className="text-sm">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Fixed fee (USD)</span>
              <input type="number" min={0} step="0.01" value={form.fee_fixed_dollars}
                onChange={(e) => setForm({ ...form, fee_fixed_dollars: e.target.value })}
                className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
            </label>
          )}
          {form.fee_type === "percentage" && (
            <label className="text-sm">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Percentage (0–100)</span>
              <input type="number" min={0} max={100} step="0.01" value={form.fee_percent}
                onChange={(e) => setForm({ ...form, fee_percent: e.target.value })}
                className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
            </label>
          )}
          {form.fee_type !== "none" && (
            <label className="text-sm">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Fee cap (USD, optional)</span>
              <input type="number" min={0} step="0.01" value={form.fee_cap_dollars}
                onChange={(e) => setForm({ ...form, fee_cap_dollars: e.target.value })}
                className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
            </label>
          )}
          <label className="text-sm flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={form.admin_review_required}
              onChange={(e) => setForm({ ...form, admin_review_required: e.target.checked })} />
            Administrator review required before any fee is applied.
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Customer-facing summary</span>
            <textarea value={form.customer_summary}
              onChange={(e) => setForm({ ...form, customer_summary: e.target.value })}
              rows={4}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" required />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Internal notes (admin only)</span>
            <textarea value={form.internal_notes}
              onChange={(e) => setForm({ ...form, internal_notes: e.target.value })}
              rows={2}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost-luxe" disabled={saving}>Cancel</button>
          <button onClick={submit} className="btn-luxe" disabled={saving}>{saving ? "Saving…" : "Save as draft"}</button>
        </div>
      </div>
    </div>
  );
}

/* --------- No-show editor --------- */
type NoShowFormMode = { kind: "create" } | { kind: "version"; policy_key: string; from: NoShowPolicy };

function NoShowEditor({
  mode, onClose, onSaved,
}: { mode: NoShowFormMode; onClose: () => void; onSaved: () => void }) {
  const initial = mode.kind === "version" ? mode.from : null;
  const [form, setForm] = useState({
    policy_key: initial?.policy_key ?? "",
    name: initial?.name ?? "",
    service_type: (initial?.service_type ?? "standard") as ServiceType,
    no_show_enabled: initial?.no_show_enabled ?? true,
    min_wait_minutes: initial ? Math.round(initial.min_wait_seconds / 60) : 15,
    required_contact_attempts: initial?.required_contact_attempts ?? 1,
    fee_type: (initial?.fee_type ?? "none") as FeeType,
    fee_fixed_dollars: initial?.fee_fixed_cents != null ? (initial.fee_fixed_cents / 100).toString() : "",
    fee_percent: initial?.fee_percent_bps != null ? (initial.fee_percent_bps / 100).toString() : "",
    fee_cap_dollars: initial?.fee_cap_cents != null ? (initial.fee_cap_cents / 100).toString() : "",
    automatic_charge_enabled: initial?.automatic_charge_enabled ?? false,
    admin_review_required: initial?.admin_review_required ?? true,
    customer_summary: initial?.customer_summary ?? "",
    internal_notes: initial?.internal_notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        service_type: form.service_type,
        no_show_enabled: form.no_show_enabled,
        min_wait_seconds: Math.max(0, Math.round(Number(form.min_wait_minutes) * 60)),
        required_contact_attempts: Number(form.required_contact_attempts) || 0,
        fee_type: form.fee_type,
        fee_fixed_cents:
          form.fee_type === "fixed" && form.fee_fixed_dollars !== ""
            ? Math.round(Number(form.fee_fixed_dollars) * 100)
            : null,
        fee_percent_bps:
          form.fee_type === "percentage" && form.fee_percent !== ""
            ? Math.round(Number(form.fee_percent) * 100)
            : null,
        fee_cap_cents:
          form.fee_type !== "none" && form.fee_cap_dollars !== ""
            ? Math.round(Number(form.fee_cap_dollars) * 100)
            : null,
        automatic_charge_enabled: form.automatic_charge_enabled,
        admin_review_required: form.admin_review_required,
        customer_summary: form.customer_summary.trim(),
        internal_notes: form.internal_notes.trim() || null,
      };
      if (mode.kind === "create") {
        if (!form.policy_key.trim()) throw new Error("Policy key is required.");
        await adminCreateNoShowPolicy({
          data: { payload: { ...payload, policy_key: form.policy_key.trim() } },
        });
      } else {
        await adminCreateNoShowPolicyVersion({
          data: { policy_key: mode.policy_key, payload },
        });
      }
      toast.success("Draft policy version created (inactive).");
      onSaved();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 overflow-y-auto" role="dialog" aria-modal>
      <div className="w-full max-w-2xl my-8 rounded-xl border border-border/60 bg-background p-5 shadow-2xl">
        <h3 className="font-display text-lg mb-3">
          {mode.kind === "create" ? "New no-show policy" : `New version of “${mode.policy_key}”`}
        </h3>
        {error && <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {mode.kind === "create" && (
            <label className="text-sm sm:col-span-2">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Policy key</span>
              <input value={form.policy_key} onChange={(e) => setForm({ ...form, policy_key: e.target.value })}
                className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2"
                placeholder="e.g. standard_no_show" required />
            </label>
          )}
          <label className="text-sm sm:col-span-2">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" required />
          </label>
          <label className="text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Pickup context</span>
            <select value={form.service_type}
              onChange={(e) => setForm({ ...form, service_type: e.target.value as ServiceType })}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2">
              <option value="standard">Standard</option>
              <option value="airport">Airport</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Minimum waiting time (minutes)</span>
            <input type="number" min={0} value={form.min_wait_minutes}
              onChange={(e) => setForm({ ...form, min_wait_minutes: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
          </label>
          <label className="text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Required contact attempts</span>
            <input type="number" min={0} max={10} value={form.required_contact_attempts}
              onChange={(e) => setForm({ ...form, required_contact_attempts: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
          </label>
          <label className="text-sm flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={form.no_show_enabled}
              onChange={(e) => setForm({ ...form, no_show_enabled: e.target.checked })} />
            No-show workflow enabled.
          </label>
          <label className="text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Fee type</span>
            <select value={form.fee_type}
              onChange={(e) => setForm({ ...form, fee_type: e.target.value as FeeType })}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2">
              <option value="none">No fee</option>
              <option value="fixed">Fixed</option>
              <option value="percentage">Percentage</option>
              <option value="full_fare">Full fare</option>
            </select>
          </label>
          {form.fee_type === "fixed" && (
            <label className="text-sm">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Fixed fee (USD)</span>
              <input type="number" min={0} step="0.01" value={form.fee_fixed_dollars}
                onChange={(e) => setForm({ ...form, fee_fixed_dollars: e.target.value })}
                className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
            </label>
          )}
          {form.fee_type === "percentage" && (
            <label className="text-sm">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Percentage (0–100)</span>
              <input type="number" min={0} max={100} step="0.01" value={form.fee_percent}
                onChange={(e) => setForm({ ...form, fee_percent: e.target.value })}
                className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
            </label>
          )}
          {form.fee_type !== "none" && (
            <label className="text-sm">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Fee cap (USD, optional)</span>
              <input type="number" min={0} step="0.01" value={form.fee_cap_dollars}
                onChange={(e) => setForm({ ...form, fee_cap_dollars: e.target.value })}
                className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
            </label>
          )}
          <label className="text-sm flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={form.automatic_charge_enabled}
              onChange={(e) => setForm({ ...form, automatic_charge_enabled: e.target.checked })} />
            Automatic financial action allowed (not wired in this release).
          </label>
          <label className="text-sm flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={form.admin_review_required}
              onChange={(e) => setForm({ ...form, admin_review_required: e.target.checked })} />
            Administrator review required before any fee is applied.
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Customer-facing summary</span>
            <textarea value={form.customer_summary}
              onChange={(e) => setForm({ ...form, customer_summary: e.target.value })}
              rows={4}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" required />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Internal notes (admin only)</span>
            <textarea value={form.internal_notes}
              onChange={(e) => setForm({ ...form, internal_notes: e.target.value })}
              rows={2}
              className="mt-1 w-full rounded-md border border-border/60 bg-surface/40 p-2" />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost-luxe" disabled={saving}>Cancel</button>
          <button onClick={submit} className="btn-luxe" disabled={saving}>{saving ? "Saving…" : "Save as draft"}</button>
        </div>
      </div>
    </div>
  );
}

/* --------- Panel --------- */
export function BookingPoliciesPanel() {
  const [tab, setTab] = useState<"cancellation" | "no_show">("cancellation");
  const [loading, setLoading] = useState(true);
  const [cancel, setCancel] = useState<CancellationPolicy[]>([]);
  const [noshow, setNoshow] = useState<NoShowPolicy[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [cancelEditor, setCancelEditor] = useState<CancelFormMode | null>(null);
  const [noshowEditor, setNoshowEditor] = useState<NoShowFormMode | null>(null);
  const [confirm, setConfirm] = useState<
    | null
    | { kind: "activate" | "deactivate"; policyKind: "cancellation" | "no_show"; id: string; name: string }
  >(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, n] = await Promise.all([
        adminListCancellationPolicies(),
        adminListNoShowPolicies(),
      ]);
      setCancel((c ?? []) as unknown as CancellationPolicy[]);
      setNoshow((n ?? []) as unknown as NoShowPolicy[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load policies.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const cancelGroups = useMemo(() => groupByKeyService(cancel), [cancel]);
  const noshowGroups = useMemo(() => groupByKeyService(noshow), [noshow]);

  const runConfirm = async (reason: string) => {
    if (!confirm) return;
    try {
      if (confirm.policyKind === "cancellation") {
        if (confirm.kind === "activate") await adminActivateCancellationPolicy({ data: { id: confirm.id, reason } });
        else await adminDeactivateCancellationPolicy({ data: { id: confirm.id, reason } });
      } else {
        if (confirm.kind === "activate") await adminActivateNoShowPolicy({ data: { id: confirm.id, reason } });
        else await adminDeactivateNoShowPolicy({ data: { id: confirm.id, reason } });
      }
      toast.success(confirm.kind === "activate" ? "Policy activated." : "Policy deactivated.");
      setConfirm(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">Operations</div>
        <h1 className="mt-1 font-display text-3xl">Booking Policies</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage versioned cancellation and no-show policies. Every change is recorded in the audit log.
        </p>
      </div>

      <div className="rounded-xl border border-gold/25 bg-gold/5 p-4 text-sm text-gold/90">
        <div className="flex items-start gap-2">
          <ScrollText className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            No financial charge is performed by this settings screen in the current implementation.
            These settings establish versioned operational policy values for later booking, cancellation
            and no-show workflows.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        {(["cancellation", "no_show"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={
              "rounded-xl border px-4 py-2 text-sm transition " +
              (tab === k
                ? "border-gold/50 bg-gold/10 text-gold"
                : "border-border/60 bg-surface/40 text-foreground hover:border-gold/30")
            }
          >
            {k === "cancellation" ? "Cancellation" : "No-Show"}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {loading ? (
        <div className="rounded-xl border border-border/60 bg-surface/40 p-6"><SkeletonLines count={6} /></div>
      ) : tab === "cancellation" ? (
        <section className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setCancelEditor({ kind: "create" })} className="btn-luxe">
              <PlusCircle className="mr-2 h-4 w-4" /> New cancellation policy
            </button>
          </div>
          {cancelGroups.size === 0 && (
            <div className="rounded-xl border border-border/60 bg-surface/40 p-6 text-sm text-muted-foreground">
              No cancellation policies yet.
            </div>
          )}
          {[...cancelGroups.entries()].map(([groupKey, versions]) => {
            const latest = versions[0];
            const active = versions.find((v) => v.active) ?? null;
            return (
              <div key={groupKey} className="rounded-xl border border-border/60 bg-surface/40">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{latest.name}</div>
                      <StatusPill active={!!active} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <code className="rounded bg-black/40 px-1 py-0.5">{latest.policy_key}</code> · service: {latest.service_type} · latest v{latest.version}
                    </div>
                  </div>
                  <button
                    onClick={() => setCancelEditor({ kind: "version", policy_key: latest.policy_key, from: active ?? latest })}
                    className="btn-ghost-luxe"
                  >
                    <PlusCircle className="mr-2 h-4 w-4" /> New version
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                      <tr>
                        <th className="p-3">Version</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Free cutoff</th>
                        <th className="p-3">Fee</th>
                        <th className="p-3">Cap</th>
                        <th className="p-3">Review</th>
                        <th className="p-3">Effective</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v) => (
                        <tr key={v.id} className="border-t border-border/40">
                          <td className="p-3">v{v.version}</td>
                          <td className="p-3"><StatusPill active={v.active} /></td>
                          <td className="p-3">{v.free_cancellation_enabled ? `${v.free_cancellation_cutoff_hours}h` : "off"}</td>
                          <td className="p-3">{feeTypeLabel(v.fee_type)} · {fmtFee(v)}</td>
                          <td className="p-3">{fmtCap(v.fee_cap_cents)}</td>
                          <td className="p-3">{v.admin_review_required ? "Required" : "Not required"}</td>
                          <td className="p-3">{new Date(v.effective_at).toLocaleDateString()}</td>
                          <td className="p-3 text-right">
                            {v.active ? (
                              <button
                                onClick={() => setConfirm({ kind: "deactivate", policyKind: "cancellation", id: v.id, name: v.name })}
                                className="btn-ghost-luxe text-xs"
                              >
                                <PauseCircle className="mr-1 h-3.5 w-3.5" /> Deactivate
                              </button>
                            ) : (
                              <button
                                onClick={() => setConfirm({ kind: "activate", policyKind: "cancellation", id: v.id, name: v.name })}
                                className="btn-ghost-luxe text-xs"
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Activate
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {active && (
                  <div className="border-t border-border/40 p-4 text-xs text-muted-foreground">
                    <div className="mb-1 uppercase tracking-widest">Customer-facing summary (active v{active.version})</div>
                    <p className="whitespace-pre-wrap text-sm text-foreground/90">{active.customer_summary}</p>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ) : (
        <section className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setNoshowEditor({ kind: "create" })} className="btn-luxe">
              <PlusCircle className="mr-2 h-4 w-4" /> New no-show policy
            </button>
          </div>
          {noshowGroups.size === 0 && (
            <div className="rounded-xl border border-border/60 bg-surface/40 p-6 text-sm text-muted-foreground">
              No no-show policies yet.
            </div>
          )}
          {[...noshowGroups.entries()].map(([groupKey, versions]) => {
            const latest = versions[0];
            const active = versions.find((v) => v.active) ?? null;
            return (
              <div key={groupKey} className="rounded-xl border border-border/60 bg-surface/40">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{latest.name}</div>
                      <StatusPill active={!!active} />
                      <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                        {latest.service_type}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <code className="rounded bg-black/40 px-1 py-0.5">{latest.policy_key}</code> · latest v{latest.version}
                    </div>
                  </div>
                  <button
                    onClick={() => setNoshowEditor({ kind: "version", policy_key: latest.policy_key, from: active ?? latest })}
                    className="btn-ghost-luxe"
                  >
                    <PlusCircle className="mr-2 h-4 w-4" /> New version
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                      <tr>
                        <th className="p-3">Version</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Wait</th>
                        <th className="p-3">Contacts</th>
                        <th className="p-3">Fee</th>
                        <th className="p-3">Cap</th>
                        <th className="p-3">Auto charge</th>
                        <th className="p-3">Review</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v) => (
                        <tr key={v.id} className="border-t border-border/40">
                          <td className="p-3">v{v.version}</td>
                          <td className="p-3"><StatusPill active={v.active} /></td>
                          <td className="p-3">{Math.round(v.min_wait_seconds / 60)} min</td>
                          <td className="p-3">{v.required_contact_attempts}</td>
                          <td className="p-3">{feeTypeLabel(v.fee_type)} · {fmtFee(v)}</td>
                          <td className="p-3">{fmtCap(v.fee_cap_cents)}</td>
                          <td className="p-3">{v.automatic_charge_enabled ? "On" : "Off"}</td>
                          <td className="p-3">{v.admin_review_required ? "Required" : "Not required"}</td>
                          <td className="p-3 text-right">
                            {v.active ? (
                              <button
                                onClick={() => setConfirm({ kind: "deactivate", policyKind: "no_show", id: v.id, name: v.name })}
                                className="btn-ghost-luxe text-xs"
                              >
                                <PauseCircle className="mr-1 h-3.5 w-3.5" /> Deactivate
                              </button>
                            ) : (
                              <button
                                onClick={() => setConfirm({ kind: "activate", policyKind: "no_show", id: v.id, name: v.name })}
                                className="btn-ghost-luxe text-xs"
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Activate
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {active && (
                  <div className="border-t border-border/40 p-4 text-xs text-muted-foreground">
                    <div className="mb-1 uppercase tracking-widest">Customer-facing summary (active v{active.version})</div>
                    <p className="whitespace-pre-wrap text-sm text-foreground/90">{active.customer_summary}</p>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {cancelEditor && (
        <CancellationEditor
          mode={cancelEditor}
          onClose={() => setCancelEditor(null)}
          onSaved={refresh}
        />
      )}
      {noshowEditor && (
        <NoShowEditor
          mode={noshowEditor}
          onClose={() => setNoshowEditor(null)}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === "activate" ? "Activate policy?" : "Deactivate policy?"}
        message={
          confirm?.kind === "activate"
            ? `Activating “${confirm?.name}” will deactivate any other active version for the same context.`
            : `Deactivating “${confirm?.name}” will leave this context without an active policy until another version is activated.`
        }
        confirmLabel={confirm?.kind === "activate" ? "Activate" : "Deactivate"}
        destructive={confirm?.kind === "deactivate"}
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirm}
      />
    </div>
  );
}
