import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/ops/StatusPill";
import { AssignmentPanel } from "@/components/ops/AssignmentPanel";
import { ArrowLeft, MapPin, User, UserCog, Car, CreditCard, StickyNote, Clock, Navigation } from "lucide-react";

export const Route = createFileRoute("/admin/trips/$id")({
  head: () => ({
    meta: [
      { title: "Trip — HarborLine Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: TripDetail,
});

interface TripDetailData {
  id: string;
  pickup: string; dropoff: string;
  pickup_time: string;
  status: string; paid: boolean | null; paid_at: string | null;
  price: number | null; suggested_price: number | null;
  distance_km: number | null;
  ride_type: string;
  passengers: number;
  notes: string | null;
  created_at: string;
  pickup_lat: number | null; pickup_lng: number | null;
  dropoff_lat: number | null; dropoff_lng: number | null;
  stripe_session_id: string | null;
  receipt_url: string | null;
  passenger_id: string;
}

function TripDetail() {
  const { id } = Route.useParams();
  const [trip, setTrip] = useState<TripDetailData | null>(null);
  const [passenger, setPassenger] = useState<any>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async (initial: boolean) => {
      if (initial) setBusy(true);
      const [b, a] = await Promise.all([
        supabase.from("bookings").select("*").eq("id", id).maybeSingle(),
        (supabase as any)
          .from("booking_assignments")
          .select("*, driver:driver_id(id, full_name, employee_id, phone, email, availability_status, assigned_vehicle_id), vehicle:vehicle_id(id, name, license_plate, category, seats)")
          .eq("booking_id", id).eq("is_current", true).maybeSingle(),
      ]);
      if (!alive) return;
      const t = (b.data ?? null) as TripDetailData | null;
      setTrip(t);
      setAssignment(a.data ?? null);
      if (t?.passenger_id) {
        const { data: p } = await supabase.from("profiles").select("*").eq("id", t.passenger_id).maybeSingle();
        if (alive) setPassenger(p ?? null);
      }
      if (initial) setBusy(false);

      // Poll only while trip is active
      const effective = (a.data as any)?.dispatch_status ?? t?.status;
      const terminal = effective === "completed" || effective === "cancelled" || t?.status === "completed" || t?.status === "cancelled";
      if (alive && !terminal) {
        timer = setTimeout(() => { void load(false); }, 10_000);
      }
    };

    void load(true);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [id]);

  if (busy) return <div className="text-muted-foreground text-sm">Loading trip…</div>;
  if (!trip) return (
    <div className="max-w-md mx-auto text-center py-16">
      <p className="text-muted-foreground text-sm">Trip not found.</p>
      <Link to="/admin/trips" className="mt-4 inline-flex items-center gap-2 text-sm text-gold hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to trips
      </Link>
    </div>
  );

  const passengerName = passenger ? `${passenger.name ?? ""} ${passenger.surname ?? ""}`.trim() : "—";
  const priceValue = trip.price ?? trip.suggested_price ?? 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link to="/admin/trips" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All trips
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">Trip #{trip.id.slice(0, 8)}</div>
          <h1 className="font-display text-3xl mt-1">{trip.pickup} <span className="text-gold mx-1">→</span> {trip.dropoff}</h1>
          <div className="mt-2 text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {new Date(trip.pickup_time).toLocaleString()}</span>
            <span>·</span>
            <span className="capitalize">{trip.ride_type}</span>
            <span>·</span>
            <span>{trip.passengers} passenger{trip.passengers === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={((assignment?.dispatch_status ?? trip.status) as any) ?? "muted"}>{String(assignment?.dispatch_status ?? trip.status).replace("_", " ")}</StatusPill>
          <StatusPill tone={trip.paid ? "paid" : "unpaid"}>{trip.paid ? "Paid" : "Unpaid"}</StatusPill>
        </div>
      </div>

      {/* E. Live Status + F. Timeline (dispatch) */}
      <Section title="Live status & timeline" icon={<Navigation className="h-4 w-4" />}>
        <AssignmentPanel bookingId={trip.id} />
      </Section>

      {/* Main grid: passenger / driver / vehicle */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Passenger" icon={<User className="h-4 w-4" />}>
          {passenger ? (
            <div className="text-sm space-y-1.5">
              <div className="font-medium">{passengerName || "—"}</div>
              <div className="text-muted-foreground">{passenger.email ?? "—"}</div>
              <div className="text-muted-foreground">{passenger.phone ?? "—"}</div>
              {passenger.preferred_language && <div className="text-xs text-muted-foreground">Language: {passenger.preferred_language}</div>}
              <div className="pt-2">
                <Link to="/admin/customers/$id" params={{ id: passenger.id }} className="text-xs text-gold hover:underline">
                  View customer profile →
                </Link>
              </div>
            </div>
          ) : <Empty>No passenger profile.</Empty>}
        </Section>

        <Section title="Driver" icon={<UserCog className="h-4 w-4" />}>
          {assignment?.driver ? (
            <div className="text-sm space-y-1.5">
              <div className="font-medium">{assignment.driver.full_name ?? "—"}</div>
              <div className="text-xs text-muted-foreground font-mono">{assignment.driver.employee_id}</div>
              <div className="text-muted-foreground">{assignment.driver.email ?? "—"}</div>
              <div className="text-muted-foreground">{assignment.driver.phone ?? "—"}</div>
              <div className="pt-1">
                <StatusPill tone={(assignment.driver.availability_status as any) ?? "muted"}>
                  {String(assignment.driver.availability_status ?? "").replace("_", " ")}
                </StatusPill>
              </div>
              <div className="pt-2">
                <Link to="/admin/drivers/$id" params={{ id: assignment.driver.id }} className="text-xs text-gold hover:underline">
                  View driver profile →
                </Link>
              </div>
            </div>
          ) : <Empty>No driver assigned. Use the dispatch panel above.</Empty>}
        </Section>

        <Section title="Vehicle" icon={<Car className="h-4 w-4" />}>
          {assignment?.vehicle ? (
            <div className="text-sm space-y-1.5">
              <div className="font-medium">{assignment.vehicle.name}</div>
              <div className="text-xs font-mono">{assignment.vehicle.license_plate}</div>
              <div className="text-muted-foreground capitalize text-xs">{assignment.vehicle.category} · {assignment.vehicle.seats} seats</div>
              <div className="pt-2">
                <Link to="/admin/vehicles/$id" params={{ id: assignment.vehicle.id }} className="text-xs text-gold hover:underline">
                  View vehicle →
                </Link>
              </div>
            </div>
          ) : <Empty>No vehicle assigned.</Empty>}
        </Section>
      </div>

      {/* Pickup & Dropoff */}
      <Section title="Pickup & dropoff" icon={<MapPin className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Pickup</div>
            <div className="text-sm">{trip.pickup}</div>
            {(trip.pickup_lat && trip.pickup_lng) && (
              <div className="text-[11px] text-muted-foreground font-mono mt-1">
                {trip.pickup_lat.toFixed(5)}, {trip.pickup_lng.toFixed(5)}
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Dropoff</div>
            <div className="text-sm">{trip.dropoff}</div>
            {(trip.dropoff_lat && trip.dropoff_lng) && (
              <div className="text-[11px] text-muted-foreground font-mono mt-1">
                {trip.dropoff_lat.toFixed(5)}, {trip.dropoff_lng.toFixed(5)}
              </div>
            )}
          </div>
          {trip.distance_km != null && (
            <div className="sm:col-span-2 text-xs text-muted-foreground">
              Distance: <span className="text-foreground tabular-nums">{Number(trip.distance_km).toFixed(1)} km</span>
            </div>
          )}
        </div>
      </Section>

      {/* Payment */}
      <Section title="Payment" icon={<CreditCard className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Field label="Amount">
            <span className="text-gold tabular-nums">${Number(priceValue).toFixed(2)}</span>
          </Field>
          <Field label="Paid">
            <StatusPill tone={trip.paid ? "paid" : "unpaid"}>{trip.paid ? "Yes" : "No"}</StatusPill>
          </Field>
          <Field label="Paid at">
            {trip.paid_at ? new Date(trip.paid_at).toLocaleString() : <span className="text-muted-foreground">—</span>}
          </Field>
          <Field label="Receipt">
            {trip.receipt_url
              ? <a href={trip.receipt_url} target="_blank" rel="noreferrer" className="text-gold hover:underline text-xs">Open</a>
              : <span className="text-muted-foreground">—</span>}
          </Field>
        </div>
        {/* Reserved space for future payout / Stripe Connect / earnings breakdown */}
        <div className="mt-4 rounded-lg border border-dashed border-border/50 p-4 text-[11px] text-muted-foreground">
          Driver earnings, platform fee, and payout status will appear here.
        </div>
      </Section>

      {/* Notes */}
      <Section title="Notes" icon={<StickyNote className="h-4 w-4" />}>
        {trip.notes ? (
          <p className="text-sm whitespace-pre-wrap">{trip.notes}</p>
        ) : <Empty>No notes on this trip.</Empty>}
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-surface/40 p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-gold/70">{icon}</span>}
        <h3 className="font-display text-base">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground">{children}</div>;
}
