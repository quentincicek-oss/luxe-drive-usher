import { cn } from "@/lib/utils";

export type DispatchStatus = "pending" | "assigned" | "accepted" | "en_route" | "arrived" | "in_progress" | "completed" | "cancelled";

const ORDER: DispatchStatus[] = ["pending", "assigned", "accepted", "en_route", "arrived", "in_progress", "completed"];

export function AssignmentTimeline({ current, onAdvance, disabled }: {
  current: DispatchStatus;
  onAdvance?: (next: DispatchStatus) => void;
  disabled?: boolean;
}) {
  const idx = ORDER.indexOf(current === "cancelled" ? "pending" : current);
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {ORDER.map((s, i) => {
        const done = i <= idx;
        const isNext = i === idx + 1;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => isNext && onAdvance?.(s)}
              disabled={disabled || !isNext}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] capitalize ring-1 ring-inset transition",
                done
                  ? "bg-gold/10 text-gold ring-gold/25"
                  : isNext
                    ? "bg-white/5 text-foreground ring-white/15 hover:bg-white/10 cursor-pointer"
                    : "bg-white/[0.03] text-muted-foreground ring-white/5 cursor-not-allowed",
              )}
            >
              {s.replace("_", " ")}
            </button>
            {i < ORDER.length - 1 && <span className="text-muted-foreground/40">›</span>}
          </li>
        );
      })}
    </ol>
  );
}
