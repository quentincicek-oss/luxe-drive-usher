import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { VehicleShowroom } from "@/components/VehicleShowroom";
import { AppHeader } from "@/components/AppHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Field } from "@/components/ui/Field";

export const Route = createFileRoute("/book")({
  head: () => ({
    meta: [
      { title: "Reserve a Ride — HarborLine Executive Services" },
      { name: "description", content: "Book your chauffeured SUV with HarborLine." },
    ],
  }),
  component: Book,
});

function Book() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [form, setForm] = useState({
    pickup: "", dropoff: "",
    pickup_time: new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
    passengers: 1, ride_type: "escalade" as "escalade" | "suburban" | "denali",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);
  useEffect(() => { document.title = `${t("book.title")} — ${t("brand.name")}`; }, [t]);

  async function reserve(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const rates: Record<string, number> = { escalade: 4.5, suburban: 4.2, denali: 4.8 };
      const est = 75 + rates[form.ride_type] * 15;
      const { error } = await supabase.from("bookings").insert({
        passenger_id: user.id,
        pickup: form.pickup, dropoff: form.dropoff,
        pickup_time: new Date(form.pickup_time).toISOString(),
        passengers: form.passengers, ride_type: form.ride_type,
        suggested_price: est,
      });
      if (error) throw error;
      toast.success(t("book.success"));
      setForm({ ...form, pickup: "", dropoff: "" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("book.failed"));
    } finally { setSaving(false); }
  }

  if (loading || !user) {
    return (
      <main className="min-h-dvh bg-obsidian">
        <div className="mx-auto max-w-3xl px-6 py-12 space-y-4">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-64 w-full" />
          <div className="skeleton h-12 w-full" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-obsidian">
      <AppHeader />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        <SectionCard
          kicker={t("book.kicker")}
          title={t("book.title")}
          description={t("book.subtitle")}
        >
          <form onSubmit={reserve} className="space-y-5">
            <Field
              label={t("book.pickup")}
              required
              value={form.pickup}
              onChange={(e) => setForm({ ...form, pickup: e.target.value })}
              placeholder={t("book.pickup.example")}
            />
            <Field
              label={t("book.dropoff")}
              required
              value={form.dropoff}
              onChange={(e) => setForm({ ...form, dropoff: e.target.value })}
              placeholder={t("book.dropoff.example")}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field
                label={t("book.time")}
                required
                type="datetime-local"
                value={form.pickup_time}
                onChange={(e) => setForm({ ...form, pickup_time: e.target.value })}
              />
              <Field
                label={t("book.passengers")}
                required
                type="number"
                min={1}
                max={7}
                value={form.passengers}
                onChange={(e) => setForm({ ...form, passengers: Number(e.target.value) })}
              />
            </div>
            <div>
              <div className="label-luxe">{t("book.ride")}</div>
              <VehicleShowroom
                value={form.ride_type}
                onChange={(v) => setForm({ ...form, ride_type: v })}
              />
            </div>
            <button disabled={saving} className="btn-primary-luxe w-full">
              {saving ? t("book.saving") : t("book.submit")}
            </button>
          </form>
        </SectionCard>
      </div>
    </main>
  );
}
