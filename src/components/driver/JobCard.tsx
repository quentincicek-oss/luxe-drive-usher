import { StatusPill } from "@/components/ops/StatusPill";
import type { DispatchStatus } from "@/components/ops/AssignmentTimeline";

const NEXT_LABEL: Record<DispatchStatus, string> = {
  pending: "Waiting",
  assigned: "Accept Job",
  accepted: "Navigate to Pickup",
  en_route: "I've Arrived",
  arrived: "Start Trip",
  in_progress: "Complete Trip",
  completed: "Done",
  cancelled: "Cancelled",
};

export function JobCard({ pickup, dropoff, pickupTime, passengers, status, onAdvance }: {
  pickup: string; dropoff: string; pickupTime: string; passengers: number;
  status: DispatchStatus; onAdvance: () => void;
}) {
  const terminal = status === "completed" || status === "cancelled";
  return (
    <div className="rounded-2xl border border-border/60 bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Assignment</div>
        <StatusPill tone={status}>{status.replace("_", " ")}</StatusPill>
      </div>
      <div className="space-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Pickup</div>
          <div className="text-sm">{pickup}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Dropoff</div>
          <div className="text-sm">{dropoff}</div>
        </div>
        <div className="flex gap-6 pt-1 text-xs text-muted-foreground">
          <span>{new Date(pickupTime).toLocaleString()}</span>
          <span>{passengers} pax</span>
        </div>
      </div>
      <button
        onClick={onAdvance}
        disabled={terminal}
        className="w-full rounded-full bg-gold-gradient px-4 py-3 text-sm font-medium text-primary-foreground shadow-gold disabled:opacity-50"
      >
        {NEXT_LABEL[status]}
      </button>
    </div>
  );
}
