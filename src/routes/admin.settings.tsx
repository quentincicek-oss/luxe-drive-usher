import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SkeletonLines } from "@/components/ui/loading";
import { adminUpsertDiscount, adminDeleteDiscount } from "@/lib/admin.functions";
import { ShieldCheck, Users, Percent, Gift } from "lucide-react";

const UsersPanel     = lazy(() => import("@/components/admin/UsersPanel").then(m => ({ default: m.UsersPanel })));
const ReferralsPanel = lazy(() => import("@/components/admin/ReferralsPanel").then(m => ({ default: m.ReferralsPanel })));
const AdminMfaPanel  = lazy(() => import("@/components/admin/AdminMfaPanel").then(m => ({ default: m.AdminMfaPanel })));

export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Settings — HarborLine Admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Settings,
});

type Tab = "users" | "discounts" | "referrals" | "mfa";

const TABS: { key: Tab; label: string; help: string; icon: any }[] = [
  { key: "users",     label: "Users",     help: "Provision staff & customers", icon: Users },
  { key: "discounts", label: "Discounts", help: "Distance discount rules",     icon: Percent },
  { key: "referrals", label: "Referrals", help: "Campaigns and codes",         icon: Gift },
  { key: "mfa",       label: "Security",  help: "Admin MFA & recovery",        icon: ShieldCheck },
];

function Fallback() {
  return <div className="rounded-xl border border-border/60 bg-surface/40 p-6"><SkeletonLines count={6} /></div>;
}

function Settings() {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">Configuration</div>
        <h1 className="font-display text-3xl mt-1">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Provisioning, pricing rules, referrals, and administrator security.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
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
              <div className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4" />{t.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{t.help}</div>
            </button>
          );
        })}
      </div>

      <Suspense fallback={<Fallback />}>
        {tab === "users"     && <UsersPanel />}
        {tab === "discounts" && <DiscountsPanel />}
        {tab === "referrals" && <ReferralsPanel />}
        {tab === "mfa"       && (
          <div className="space-y-4">
            <AdminMfaPanel />
            <div className="rounded-xl border border-border/60 bg-surface/40 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium mb-1"><ShieldCheck className="h-4 w-4 text-gold" /> Recovery codes</div>
              <p className="text-muted-foreground text-xs">Manage MFA recovery codes for administrators.</p>
              <Link to="/admin/recover" className="mt-3 inline-block text-xs text-gold hover:underline">Open MFA recovery →</Link>
            </div>
          </div>
        )}
      </Suspense>
    </div>
  );
}

interface DiscountRule { id: string; min_miles: number; max_miles: number; flat_off: number; percent_off: number; active: boolean; }

function DiscountsPanel() {
  const [rows, setRows] = useState<DiscountRule[]>([]);
  const [busy, setBusy] = useState(true);
  const upsertDiscount = useServerFn(adminUpsertDiscount);
  const deleteDiscount = useServerFn(adminDeleteDiscount);

  async function load() {
    setBusy(true);
    const { data } = await supabase.from("discount_rules").select("*").order("min_miles");
    setRows((data ?? []) as DiscountRule[]);
    setBusy(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    try {
      await upsertDiscount({ data: { id: null, payload: { min_miles: 0, max_miles: 25, flat_off: 10, percent_off: 5, active: true } } });
      load();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function del(id: string) {
    try { await deleteDiscount({ data: { id } }); load(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{busy ? "Loading…" : `${rows.length} discount rule${rows.length === 1 ? "" : "s"}`}</div>
        <button onClick={add} className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground shadow-gold">+ New rule</button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {rows.map((d) => (
          <div key={d.id} className="rounded-xl border border-border/60 bg-surface p-5 flex items-center justify-between">
            <div>
              <div className="font-display text-lg text-gradient-gold">{d.min_miles}–{d.max_miles} miles</div>
              <div className="text-xs text-muted-foreground mt-1">-${d.flat_off} flat · -{d.percent_off}%</div>
            </div>
            <button onClick={() => del(d.id)} className="text-xs text-destructive hover:underline">Delete</button>
          </div>
        ))}
      </div>
    </section>
  );
}
