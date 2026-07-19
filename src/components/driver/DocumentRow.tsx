import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date).getTime();
  return Math.floor((d - Date.now()) / 86_400_000);
}

export function DocumentRow({
  kind,
  documentNumber,
  expiresAt,
  status,
}: {
  kind: string;
  documentNumber?: string | null;
  expiresAt?: string | null;
  status: "valid" | "expiring" | "expired";
}) {
  const days = daysUntil(expiresAt ?? null);
  const tone =
    status === "expired" || (days !== null && days < 0)
      ? "bg-rose-500/10 text-rose-300 ring-rose-500/20"
      : status === "expiring" || (days !== null && days <= 30)
        ? "bg-amber-500/10 text-amber-300 ring-amber-500/20"
        : "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20";
  return (
    <div className="flex items-center justify-between rounded-xl border border-border/60 bg-surface p-4">
      <div className="flex items-center gap-3 min-w-0">
        <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-sm capitalize">{kind.replace("_", " ")}</div>
          <div className="truncate text-xs text-muted-foreground">
            {documentNumber ?? "—"}
            {expiresAt && ` · expires ${new Date(expiresAt).toLocaleDateString()}`}
          </div>
        </div>
      </div>
      <span className={cn("rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset capitalize", tone)}>
        {days !== null && days < 0 ? "expired" : status}
      </span>
    </div>
  );
}
