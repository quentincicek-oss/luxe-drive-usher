import { Check } from "lucide-react";
import { DRIVER_WORKFLOW } from "@/lib/driver.constants";
import type { DispatchStatus } from "@/components/ops/AssignmentTimeline";
import { cn } from "@/lib/utils";

const ORDER: DispatchStatus[] = [
  "pending", "assigned", "accepted", "en_route", "arrived", "in_progress", "completed",
];

function stepIndex(status: DispatchStatus, verified: boolean): number {
  // Map dispatch_status → workflow step index (0..9)
  const s = ORDER.indexOf(status === "cancelled" ? "pending" : status);
  // pending/assigned → step "new" (0) or "reviewed" (1)
  if (status === "pending" || status === "assigned") return 1;
  if (status === "accepted") return 2;
  if (status === "en_route") return 3;
  if (status === "arrived") return verified ? 6 : 4; // arrived → waiting/verified
  if (status === "in_progress") return 7;
  if (status === "completed") return 9;
  return s;
}

export function WorkflowStepper({
  status,
  verified = false,
}: {
  status: DispatchStatus;
  verified?: boolean;
}) {
  const active = stepIndex(status, verified);
  return (
    <ol className="space-y-1">
      {DRIVER_WORKFLOW.map((step, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={step.key} className="flex items-center gap-3 py-1.5">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium",
                done && "bg-gold text-primary-foreground",
                current && "bg-gold/20 text-gold ring-2 ring-gold/40",
                !done && !current && "bg-white/5 text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn("text-sm capitalize", current ? "text-foreground" : "text-muted-foreground")}>
              {step.key.replace(/_/g, " ")}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
