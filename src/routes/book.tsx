import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { VehicleShowroom } from "@/components/VehicleShowroom";
import { AppHeader } from "@/components/AppHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Field } from "@/components/ui/Field";
import { AmenitiesSelector } from "@/components/booking/AmenitiesSelector";
import { AddressAutocomplete, type StructuredAddress } from "@/components/booking/AddressAutocomplete";
import { createBookingServer } from "@/lib/dispatch.functions";
import { setBookingAmenities } from "@/lib/amenities.functions";
import { Minus, Plus, Loader2 } from "lucide-react";

export const Route = createFileRoute("/book")({
  head: () => ({
    meta: [
      { title: "Reserve a Ride — HarborLine Executive Services" },
      { name: "description", content: "Book your chauffeured SUV with HarborLine." },
    ],
  }),
  component: Book,
});

const RATES: Record<string, number> = { escalade: 4.5, suburban: 4.2, denali: 4.8 };

function Book() {
  const { user, role, loading, roleLoading } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [form, setForm] = useState({
    pickup: "", dropoff: "",
    pickup_time: new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
    passengers: 1, ride_type: "escalade" as "escalade" | "suburban" | "denali",
  });
  const [pickupAddr, setPickupAddr] = useState<StructuredAddress | null>(null);
  const [dropoffAddr, setDropoffAddr] = useState<StructuredAddress | null>(null);
  const [amenityIds, setAmenityIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ pickup?: string; dropoff?: string; time?: string }>({});

  const pickupRef = useRef<HTMLDivElement>(null);
  const dropoffRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading || roleLoading) return;
    if (!user) { nav({ to: "/auth" }); return; }
    if (role === "admin") { nav({ to: "/admin" }); return; }
    if (role === "driver") { nav({ to: "/driver" }); }
  }, [user, role, loading, roleLoading, nav]);
  useEffect(() => { document.title = `${t("book.title")} — ${t("brand.name")}`; }, [t]);

  const estimate = useMemo(() => Math.round(75 + RATES[form.ride_type] * 15), [form.ride_type]);

  const createBookingFn = useServerFn(createBookingServer);
  const setAmenitiesFn = useServerFn(setBookingAmenities);

  function validate() {
    const next: typeof errors = {};
    if (!form.pickup.trim()) next.pickup = t("book.pickup.required");
    if (!form.dropoff.trim()) next.dropoff = t("book.dropoff.required");
    if (!form.pickup_time) next.time = t("book.time.required");
    else if (new Date(form.pickup_time).getTime() <= Date.now()) next.time = t("book.time.past");
    return next;
  }

  function scrollToFirst(next: typeof errors) {
    const order: Array<[keyof typeof errors, React.RefObject<HTMLDivElement | null>]> = [
      ["pickup", pickupRef], ["dropoff", dropoffRef], ["time", timeRef],
    ];
    for (const [k, r] of order) {
      if (next[k] && r.current) {
        r.current.scrollIntoView({ behavior: "smooth", block: "center" });
        const input = r.current.querySelector<HTMLInputElement>("input");
        setTimeout(() => input?.focus({ preventScroll: true }), 250);
        break;
      }
    }
  }

  async function reserve(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) {
      scrollToFirst(next);
      return;
    }
    setSaving(true);
    try {
      const { id } = await createBookingFn({ data: {
        pickup: form.pickup,
        dropoff: form.dropoff,
        pickupTime: new Date(form.pickup_time).toISOString(),
        passengers: form.passengers,
        rideType: form.ride_type,
        pickupLat: pickupAddr?.lat ?? null,
        pickupLng: pickupAddr?.lng ?? null,
        pickupPlaceId: pickupAddr?.placeId ?? null,
        pickupComponents: (pickupAddr?.components ?? null) as Record<string, string> | null,
        dropoffLat: dropoffAddr?.lat ?? null,
        dropoffLng: dropoffAddr?.lng ?? null,
        dropoffPlaceId: dropoffAddr?.placeId ?? null,
        dropoffComponents: (dropoffAddr?.components ?? null) as Record<string, string> | null,
      }});
      if (amenityIds.length > 0 && id) {
        try {
          await setAmenitiesFn({ data: { bookingId: id, amenityIds } });
        } catch (err) {
          toast.error("Reservation saved, but preferences failed: " + (err as Error).message);
        }
      }
      toast.success(t("book.success"));
      nav({ to: "/history" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("book.failed"));
      setSaving(false);
    }
  }


  if (loading || roleLoading || !user || role === "admin") {
    return (
      <main id="main-content" className="min-h-dvh bg-obsidian">
        <div className="mx-auto max-w-3xl px-6 py-12 space-y-4">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-64 w-full" />
          <div className="skeleton h-12 w-full" />
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-dvh bg-obsidian pb-32 sm:pb-16">
      <AppHeader />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
        <SectionCard
          kicker={t("book.kicker")}
          title={t("book.title")}
          description={t("book.subtitle")}
        >
          <form id="book-form" onSubmit={reserve} noValidate className="space-y-5">
            <div ref={pickupRef}>
              <AddressAutocomplete
                label={t("book.pickup")}
                required
                value={form.pickup}
                error={errors.pickup ?? null}
                onTextChange={(v) => {
                  setForm({ ...form, pickup: v });
                  if (errors.pickup) setErrors((e) => ({ ...e, pickup: undefined }));
                }}
                onSelect={(a) => {
                  setPickupAddr(a);
                  setForm((f) => ({ ...f, pickup: a.formatted }));
                  setErrors((e) => ({ ...e, pickup: undefined }));
                }}
                onClear={() => setPickupAddr(null)}
                placeholder={t("book.pickup.example")}
                autoComplete="off"
              />
            </div>
            <div ref={dropoffRef}>
              <AddressAutocomplete
                label={t("book.dropoff")}
                required
                value={form.dropoff}
                error={errors.dropoff ?? null}
                onTextChange={(v) => {
                  setForm({ ...form, dropoff: v });
                  if (errors.dropoff) setErrors((e) => ({ ...e, dropoff: undefined }));
                }}
                onSelect={(a) => {
                  setDropoffAddr(a);
                  setForm((f) => ({ ...f, dropoff: a.formatted }));
                  setErrors((e) => ({ ...e, dropoff: undefined }));
                }}
                onClear={() => setDropoffAddr(null)}
                placeholder={t("book.dropoff.example")}
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div ref={timeRef}>
                <Field
                  label={t("book.time")}
                  required
                  type="datetime-local"
                  value={form.pickup_time}
                  error={errors.time ?? null}
                  onChange={(e) => {
                    setForm({ ...form, pickup_time: e.target.value });
                    if (errors.time) setErrors((er) => ({ ...er, time: undefined }));
                  }}
                />
              </div>
              <div>
                <div className="label-luxe">{t("book.passengers")}</div>
                <PassengerStepper
                  value={form.passengers}
                  onChange={(n) => setForm({ ...form, passengers: n })}
                />
              </div>
            </div>

            <div>
              <div className="label-luxe">{t("book.ride")}</div>
              <VehicleShowroom
                value={form.ride_type}
                onChange={(v) => setForm({ ...form, ride_type: v })}
              />
            </div>

            <AmenitiesSelector
              rideType={form.ride_type}
              selectedIds={amenityIds}
              onChange={setAmenityIds}
            />


            {/* Desktop submit */}
            <div className="hidden sm:flex items-center justify-between gap-4 pt-2">
              <FareEstimate value={estimate} />
              <button disabled={saving} className="btn-primary-luxe min-w-56">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? t("book.saving") : t("book.submit")}
              </button>
            </div>
          </form>
        </SectionCard>
      </div>

      {/* Mobile sticky action bar */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border/60 bg-background/90 backdrop-blur-xl px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="flex items-center justify-between gap-3">
          <FareEstimate value={estimate} />
          <button
            type="submit"
            form="book-form"
            disabled={saving}
            className="btn-primary-luxe flex-1"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t("book.saving") : t("book.submit")}
          </button>
        </div>
      </div>
    </main>
  );
}

function FareEstimate({ value }: { value: number }) {
  const { t } = useI18n();
  return (
    <div className="leading-tight">
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">
        {t("book.estimate") !== "book.estimate" ? t("book.estimate") : "Estimated fare"}
      </div>
      <div className="font-display text-2xl text-gradient-gold tabular-nums">${value}</div>
    </div>
  );
}

function PassengerStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.min(7, Math.max(1, n));
  return (
    <div className="flex items-center justify-between rounded-lg bg-input border border-border/60 px-2 h-[46px]">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= 1}
        aria-label="Decrease"
        className="h-10 w-10 grid place-items-center rounded-md hover:bg-accent disabled:opacity-40"
      >
        <Minus className="h-4 w-4" />
      </button>
      <div className="font-display text-lg tabular-nums">{value}</div>
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= 7}
        aria-label="Increase"
        className="h-10 w-10 grid place-items-center rounded-md hover:bg-accent disabled:opacity-40"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
