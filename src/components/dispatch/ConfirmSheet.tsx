import { useEffect, useState } from "react";

export function ConfirmSheet({
  open, title, description, confirmLabel = "Confirm", requireReason = false,
  tone = "gold", onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  requireReason?: boolean;
  tone?: "gold" | "danger";
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(""); setBusy(false); } }, [open]);
  if (!open) return null;
  const btn = tone === "danger"
    ? "bg-rose-500/90 hover:bg-rose-500 text-white"
    : "bg-gold-gradient text-primary-foreground shadow-gold";
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {requireReason && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            className="mt-4 w-full rounded-lg border border-border/60 bg-input p-3 text-sm min-h-[80px]"
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button
            disabled={busy || (requireReason && !reason.trim())}
            onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); onClose(); } finally { setBusy(false); } }}
            className={`rounded-full px-5 py-2 text-sm font-medium disabled:opacity-50 ${btn}`}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
