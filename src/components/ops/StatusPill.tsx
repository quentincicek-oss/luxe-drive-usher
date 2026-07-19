import { cn } from "@/lib/utils";

type Tone = "available" | "assigned" | "on_trip" | "offline" | "vacation" | "active" | "maintenance" | "pending" | "accepted" | "en_route" | "arrived" | "in_progress" | "completed" | "cancelled" | "muted";

const styles: Record<Tone, string> = {
  available:   "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
  assigned:    "bg-gold/10 text-gold ring-gold/25",
  on_trip:     "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  offline:     "bg-white/5 text-muted-foreground ring-white/10",
  vacation:    "bg-violet-500/10 text-violet-300 ring-violet-500/20",
  active:      "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
  maintenance: "bg-amber-500/10 text-amber-300 ring-amber-500/20",
  pending:     "bg-white/5 text-muted-foreground ring-white/10",
  accepted:    "bg-gold/10 text-gold ring-gold/25",
  en_route:    "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  arrived:     "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  in_progress: "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  completed:   "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
  cancelled:   "bg-rose-500/10 text-rose-300 ring-rose-500/20",
  muted:       "bg-white/5 text-muted-foreground ring-white/10",
};

export function StatusPill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset capitalize",
      styles[tone] ?? styles.muted,
      className,
    )}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}
