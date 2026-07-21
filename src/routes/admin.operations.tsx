import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { SkeletonLines } from "@/components/ui/loading";

const IncidentFeed     = lazy(() => import("@/components/dispatch/IncidentFeed").then(m => ({ default: m.IncidentFeed })));
const FleetExpirations = lazy(() => import("@/components/dispatch/FleetExpirations").then(m => ({ default: m.FleetExpirations })));
const ScheduleGrid     = lazy(() => import("@/components/dispatch/ScheduleGrid").then(m => ({ default: m.ScheduleGrid })));
const AuditTable       = lazy(() => import("@/components/dispatch/AuditTable").then(m => ({ default: m.AuditTable })));
const SupportPanel     = lazy(() => import("@/components/admin/SupportPanel").then(m => ({ default: m.SupportPanel })));
const AmenitiesPanel   = lazy(() => import("@/components/admin/AmenitiesPanel").then(m => ({ default: m.AmenitiesPanel })));

export const Route = createFileRoute("/admin/operations")({
  head: () => ({ meta: [{ title: "Operations — HarborLine Admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Operations,
});

type Tab = "support" | "incidents" | "schedule" | "fleet" | "amenities" | "audit";

const TABS: { key: Tab; label: string; help: string }[] = [
  { key: "support",   label: "Support",    help: "Customer conversations" },
  { key: "incidents", label: "Incidents",  help: "Reports needing review" },
  { key: "schedule",  label: "Schedule",   help: "Assignment calendar" },
  { key: "fleet",     label: "Fleet",      help: "Document expirations" },
  { key: "amenities", label: "Amenities",  help: "Onboard catalog" },
  { key: "audit",     label: "Audit",      help: "Change log" },
];

function Fallback() {
  return <div className="rounded-xl border border-border/60 bg-surface/40 p-6"><SkeletonLines count={6} /></div>;
}

function Operations() {
  const [tab, setTab] = useState<Tab>("support");
  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">Operations</div>
        <h1 className="font-display text-3xl mt-1">Operations Center</h1>
        <p className="text-sm text-muted-foreground mt-1">Tools that run alongside dispatch — support, incidents, scheduling and audit.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "rounded-xl border p-3 text-left transition " +
              (tab === t.key
                ? "border-gold/50 bg-gold/10 text-gold"
                : "border-border/60 bg-surface/40 hover:border-gold/30 text-foreground")
            }
          >
            <div className="text-sm font-medium">{t.label}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{t.help}</div>
          </button>
        ))}
      </div>

      <Suspense fallback={<Fallback />}>
        {tab === "support"   && <SupportPanel />}
        {tab === "incidents" && <IncidentFeed />}
        {tab === "schedule"  && <ScheduleGrid />}
        {tab === "fleet"     && <FleetExpirations />}
        {tab === "amenities" && <AmenitiesPanel />}
        {tab === "audit"     && <AuditTable />}
      </Suspense>
    </div>
  );
}
