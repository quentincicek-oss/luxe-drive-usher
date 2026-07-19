import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { HarborLogo } from "@/components/HarborLogo";
import { LanguageMenu } from "@/components/LanguageMenu";
import { useI18n } from "@/lib/i18n";

interface Booking {
  id: string; pickup: string; dropoff: string; pickup_time: string;
  ride_type: string; status: string; suggested_price: number | null; price: number | null;
  passengers: number; created_at: string;
}

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Trip History — HarborLine Executive Services" },
      { name: "description", content: "Review your past HarborLine reservations." },
    ],
  }),
  component: History,
});

function History() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [rows, setRows] = useState<Booking[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("bookings").select("*").order("pickup_time", { ascending: false }).limit(100);
      setRows((data ?? []) as Booking[]);
      setBusy(false);
    })();
  }, [user]);

  if (loading || !user) return <div className="min-h-screen bg-obsidian" />;

  return (
    <main className="min-h-screen bg-obsidian">
      <header className="border-b border-border/40 backdrop-blur bg-background/50 sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <HarborLogo className="h-9 w-9" />
            <div className="font-display text-lg text-gradient-gold leading-none">HarborLine</div>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageMenu compact />
            <Link to="/book" className="text-sm rounded-full bg-gold-gradient px-5 py-2 text-primary-foreground font-medium shadow-gold">{t("history.new")}</Link>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xs tracking-[0.35em] text-gold uppercase">{t("history.kicker")}</div>
        <h1 className="mt-2 font-display text-3xl mb-8">{t("history.title")}</h1>
        {busy ? <div className="text-muted-foreground text-sm">{t("history.loading")}</div> : rows.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-surface p-10 text-center">
            <p className="text-muted-foreground">{t("history.empty")}</p>
            <Link to="/book" className="inline-block mt-4 rounded-full bg-gold-gradient px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-gold">{t("history.book")}</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((b) => (
              <div key={b.id} className="rounded-lg border border-border/60 bg-surface p-5 flex flex-wrap gap-4 items-center justify-between hover:border-gold/40 transition">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-widest">{new Date(b.pickup_time).toLocaleString()}</div>
                  <div className="mt-1 font-medium">{b.pickup} <span className="text-gold mx-2">→</span> {b.dropoff}</div>
                  <div className="mt-1 text-xs text-muted-foreground capitalize">{b.ride_type} · {b.passengers} {t("history.pax")}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">{t(`status.${b.status}`)}</div>
                  <div className="mt-1 font-display text-lg text-gradient-gold">${(b.price ?? b.suggested_price ?? 0).toFixed(0)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
