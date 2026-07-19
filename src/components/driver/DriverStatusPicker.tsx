import { useState } from "react";
import { StatusPill } from "@/components/ops/StatusPill";
import { DRIVER_AVAILABILITY } from "@/lib/driver.constants";
import { cn } from "@/lib/utils";

type Value = (typeof DRIVER_AVAILABILITY)[number]["value"];

export function DriverStatusPicker({
  value,
  onChange,
  disabled,
}: {
  value: Value;
  onChange: (v: Value) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<Value | null>(null);
  return (
    <div className="rounded-2xl border border-border/60 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Your status</div>
        <StatusPill tone={value}>{value.replace("_", " ")}</StatusPill>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {DRIVER_AVAILABILITY.map((s) => {
          const active = s.value === value;
          return (
            <button
              key={s.value}
              disabled={disabled || busy !== null || active}
              onClick={async () => {
                setBusy(s.value);
                try { await onChange(s.value); } finally { setBusy(null); }
              }}
              className={cn(
                "min-h-[52px] rounded-xl border px-3 py-2 text-sm capitalize transition",
                active
                  ? "border-gold/40 bg-gold/10 text-gold"
                  : "border-border/60 bg-white/[0.02] hover:bg-white/5",
                busy === s.value && "opacity-60",
              )}
            >
              {s.value.replace("_", " ")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
