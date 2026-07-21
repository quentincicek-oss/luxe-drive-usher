import { cn } from "@/lib/utils";

/** Shimmer skeleton block. Composable via className. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton", className)} aria-hidden="true" {...props} />;
}

/** Multi-line skeleton for text placeholders. */
export function SkeletonLines({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i === count - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Full-viewport route pending state (announced to assistive tech). */
export function RoutePending({ label = "Loading" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex min-h-dvh items-center justify-center bg-background"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
        <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{label}…</span>
      </div>
    </div>
  );
}

/** Empty state slot. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 bg-surface/40 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="font-display text-lg">{title}</div>
      {description && <p className="text-sm text-muted-foreground max-w-sm">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
