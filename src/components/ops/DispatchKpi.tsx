import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function DispatchKpi({ label, value, icon, tone = "default", hint }: {
  label: string; value: ReactNode; icon?: ReactNode; hint?: string;
  tone?: "default" | "gold" | "sky" | "emerald" | "amber";
}) {
  const toneCls = {
    default:  "text-foreground",
    gold:     "text-gold",
    sky:      "text-sky-300",
    emerald:  "text-emerald-300",
    amber:    "text-amber-300",
  }[tone];
  return (
    <div className="rounded-xl border border-border/60 bg-surface/60 p-4 sm:p-5 backdrop-blur">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground">
        <span>{label}</span>
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
      </div>
      <div className={cn("mt-2 font-display text-3xl tabular-nums", toneCls)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
