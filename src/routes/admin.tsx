import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { HarborLogo } from "@/components/HarborLogo";
import { LanguageMenu } from "@/components/LanguageMenu";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

interface Booking {
  id: string; passenger_id: string; pickup: string; dropoff: string; pickup_time: string;
  ride_type: string; status: string; price: number | null; suggested_price: number | null;
  passengers: number; created_at: string;
}
interface DiscountRule { id: string; min_miles: number; max_miles: number; flat_off: number; percent_off: number; active: boolean; }

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — HarborLine" }, { name: "description", content: "HarborLine operations dashboard." }] }),
  component: Admin,
});

function Admin() {
  const { user, role, loading } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [tab, setTab] = useState<"bookings" | "discounts" | "concierge">("bookings");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRule[]>([]);
  const [messages, setMessages] = useState<Array<{ id: string; session_id: string; role: string; content: string; user_language: string; created_at: string }>>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => { document.title = `${t("admin.console")} — ${t("brand.name")}`; }, [t]);
  useEffect(() => {
    if (loading) return;
    if (!user) { nav({ to: "/auth" }); return; }
    if (role !== null && role !== "admin") { toast.error(t("admin.accessRequired")); nav({ to: "/book" }); }
  }, [user, role, loading, nav, t]);

  async function refresh() {
    setBusy(true);
    const [b, d, m] = await Promise.all([
      supabase.from("bookings").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("discount_rules").select("*").order("min_miles"),
      supabase.from("chat_messages").select("id, session_id, role, content, user_language, created_at").order("created_at", { ascending: false }).limit(200),
    ]);
    setBookings((b.data ?? []) as Booking[]);
    setDiscounts((d.data ?? []) as DiscountRule[]);
    setMessages((m.data ?? []) as typeof messages);
    setBusy(false);
  }
  useEffect(() => { if (role === "admin") refresh(); }, [role]);

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase.from("bookings").update({ status: status as Booking["status"] } as never).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(t("admin.statusUpdated")); refresh();
  }
  async function addDiscount() {
    const { error } = await supabase.from("discount_rules").insert({ min_miles: 0, max_miles: 25, flat_off: 10, percent_off: 5 });
    if (error) { toast.error(error.message); return; }
    refresh();
  }
  async function deleteDiscount(id: string) {
    const { error } = await supabase.from("discount_rules").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    refresh();
  }

  if (loading || !user || role !== "admin") return <div className="min-h-screen bg-obsidian" />;

  return (
    <main className="min-h-screen bg-obsidian">
      <header className="border-b border-border/40 backdrop-blur bg-background/50 sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <HarborLogo className="h-9 w-9" />
            <div>
              <div className="font-display text-lg text-gradient-gold leading-none">HarborLine</div>
              <div className="text-[8px] tracking-[0.3em] text-muted-foreground mt-1 uppercase">{t("admin.console")}</div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <LanguageMenu compact />
            <Link to="/book" className="text-sm text-muted-foreground hover:text-foreground">← {t("admin.passengerView")}</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex gap-1 border-b border-border/60 mb-6">
          {(["bookings", "discounts", "concierge"] as const).map((v) => (
            <button key={v} onClick={() => setTab(v)}
              className={"px-4 py-2.5 text-sm capitalize transition border-b-2 " + (tab === v ? "border-gold text-gold" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t(`admin.tabs.${v}`)}
            </button>
          ))}
        </div>

        {busy && <div className="text-muted-foreground text-sm">{t("history.loading")}</div>}

        {tab === "bookings" && !busy && (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">{t("admin.table.pickupTime")}</th>
                  <th className="text-left px-4 py-3">{t("admin.table.route")}</th>
                  <th className="text-left px-4 py-3">{t("admin.table.vehicle")}</th>
                  <th className="text-left px-4 py-3">{t("admin.table.pax")}</th>
                  <th className="text-left px-4 py-3">{t("admin.table.price")}</th>
                  <th className="text-left px-4 py-3">{t("admin.table.status")}</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-t border-border/40 hover:bg-accent/40">
                    <td className="px-4 py-3 text-xs">{new Date(b.pickup_time).toLocaleString()}</td>
                    <td className="px-4 py-3">{b.pickup} <span className="text-gold mx-1">→</span> {b.dropoff}</td>
                    <td className="px-4 py-3 capitalize text-xs">{b.ride_type}</td>
                    <td className="px-4 py-3">{b.passengers}</td>
                    <td className="px-4 py-3 text-gold">${(b.price ?? b.suggested_price ?? 0).toFixed(0)}</td>
                    <td className="px-4 py-3">
                      <select value={b.status} onChange={(e) => updateStatus(b.id, e.target.value)}
                        className="bg-input border border-border/60 rounded px-2 py-1 text-xs capitalize">
                        {["requested", "assigned", "in_progress", "completed", "cancelled"].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
                {bookings.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">{t("admin.empty.reservations")}</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === "discounts" && !busy && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs text-muted-foreground">{t("admin.discounts.subtitle")}</div>
              <button onClick={addDiscount} className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground shadow-gold">+ {t("admin.discounts.new")}</button>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {discounts.map((d) => (
                <div key={d.id} className="rounded-lg border border-border/60 bg-surface p-5 flex items-center justify-between">
                  <div>
                    <div className="font-display text-lg text-gradient-gold">{d.min_miles}–{d.max_miles} {t("admin.discounts.miles")}</div>
                    <div className="text-xs text-muted-foreground mt-1">-${d.flat_off} {t("admin.discounts.flat")} · -{d.percent_off}% {t("admin.discounts.percent")}</div>
                  </div>
                  <button onClick={() => deleteDiscount(d.id)} className="text-xs text-destructive hover:underline">{t("admin.discounts.delete")}</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "concierge" && !busy && (
          <div className="space-y-2">
            {messages.length === 0 && <div className="text-muted-foreground text-sm">{t("admin.empty.conversations")}</div>}
            {messages.map((m) => (
              <div key={m.id} className="rounded-lg border border-border/60 bg-surface p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                  <span className="uppercase tracking-widest">{m.role} · {m.user_language}</span>
                  <span>{new Date(m.created_at).toLocaleString()}</span>
                </div>
                <div className="text-sm">{m.content}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
