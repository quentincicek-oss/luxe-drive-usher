import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitNoShow } from "@/lib/trust.functions";
import { toast } from "sonner";
import { X, UserX } from "lucide-react";

export function NoShowModal({
  bookingId,
  minWaitSeconds,
  arrivedAt,
  onClose,
  onDone,
}: {
  bookingId: string;
  minWaitSeconds: number;
  arrivedAt: Date | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [attempts, setAttempts] = useState(0);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const submit = useServerFn(submitNoShow);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const arrived = arrivedAt ?? new Date();
  const waited = Math.floor((now - arrived.getTime()) / 1000);
  const remaining = Math.max(0, minWaitSeconds - waited);
  const canSubmit = remaining === 0 && attempts > 0 && !busy;

  async function go() {
    setBusy(true);
    try {
      // Best-effort arrival GPS
      let lat: number | undefined, lng: number | undefined;
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        await new Promise<void>((res) => {
          navigator.geolocation.getCurrentPosition(
            (p) => { lat = p.coords.latitude; lng = p.coords.longitude; res(); },
            () => res(), { timeout: 3000 }
          );
        });
      }
      await submit({ data: {
        bookingId, arrivalAt: arrived.toISOString(),
        waitedSeconds: waited, attempts, arrivalLat: lat, arrivalLng: lng,
        reason: reason || undefined,
      }});
      toast.success("No-show reported");
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-border/60 bg-surface p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><UserX className="h-5 w-5 text-amber-400" /><h2 className="font-display text-lg">Report No-Show</h2></div>
          <button onClick={onClose} className="p-2 -m-2"><X className="h-5 w-5" /></button>
        </div>

        <div className="rounded-xl border border-border/60 p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Waiting time</div>
          <div className="font-mono text-2xl">
            {Math.floor(waited / 60)}:{String(waited % 60).padStart(2, "0")}
          </div>
          {remaining > 0 && (
            <div className="text-xs text-amber-300">
              Minimum wait: {Math.floor(minWaitSeconds/60)}m. {remaining}s remaining.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Communication attempts</label>
          <div className="flex items-center gap-3">
            <button onClick={() => setAttempts(Math.max(0, attempts - 1))} className="h-10 w-10 rounded-full border border-border/60">-</button>
            <div className="w-12 text-center font-mono text-lg">{attempts}</div>
            <button onClick={() => setAttempts(attempts + 1)} className="h-10 w-10 rounded-full border border-border/60">+</button>
            <div className="text-xs text-muted-foreground">calls / messages sent</div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Reason (optional)</label>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-border/60 bg-white/[0.02] p-3 text-sm"
            placeholder="Any additional context…"
          />
        </div>

        <button
          onClick={go}
          disabled={!canSubmit}
          className="w-full min-h-[52px] rounded-full bg-gold-gradient text-sm font-medium text-primary-foreground shadow-gold disabled:opacity-40"
        >
          {busy ? "Submitting…" : "Submit No-Show"}
        </button>
      </div>
    </div>
  );
}
