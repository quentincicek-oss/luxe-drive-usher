import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { DriverShell } from "@/components/driver/DriverShell";
import { DriverStatusPicker } from "@/components/driver/DriverStatusPicker";
import { StatusPill } from "@/components/ops/StatusPill";
import { ArrowUpRight, Car } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/driver/")({
  component: DriverHome,
});

function DriverHome() {
  const { user } = useAuth();
  const userId = user?.id;

  const profileQ = useQuery({
    queryKey: ["driver", "me", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("driver_profiles")
        .select("id, full_name, employee_id, availability_status, employment_status, assigned_vehicle_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) return null;
      const [vehicle] = await Promise.all([
        data.assigned_vehicle_id
          ? (supabase as any).from("vehicles").select("name, license_plate, model_year").eq("id", data.assigned_vehicle_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return { ...data, vehicle: vehicle.data };
    },
  });

  const assignmentsQ = useQuery({
    queryKey: ["driver", "assignments", "today", profileQ.data?.id],
    enabled: !!profileQ.data?.id,
    queryFn: async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const { data } = await (supabase as any)
        .from("booking_assignments")
        .select("id, booking_id, dispatch_status, is_current, bookings:booking_id(id, pickup, dropoff, pickup_time, passengers)")
        .eq("driver_id", profileQ.data!.id)
        .eq("is_current", true);
      return (data ?? []).filter((a: any) => {
        const t = a.bookings?.pickup_time ? new Date(a.bookings.pickup_time) : null;
        return t && t >= start && t <= end;
      });
    },
  });

  const upcomingQ = useQuery({
    queryKey: ["driver", "assignments", "upcoming", profileQ.data?.id],
    enabled: !!profileQ.data?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("booking_assignments")
        .select("id, booking_id, dispatch_status, is_current, bookings:booking_id(id, pickup, dropoff, pickup_time)")
        .eq("driver_id", profileQ.data!.id)
        .eq("is_current", true)
        .order("id", { ascending: false })
        .limit(20);
      return (data ?? []).filter((a: any) => {
        const t = a.bookings?.pickup_time ? new Date(a.bookings.pickup_time) : null;
        return t && t > new Date();
      });
    },
  });

  const changeStatus = async (v: string) => {
    if (!profileQ.data?.id) return;
    const { error } = await (supabase as any)
      .from("driver_profiles")
      .update({ availability_status: v })
      .eq("id", profileQ.data.id);
    if (error) return toast.error(error.message);
    toast.success("Status updated");
    profileQ.refetch();
  };

  if (!profileQ.isLoading && !profileQ.data) {
    return (
      <DriverShell title="Home">
        <div className="rounded-2xl border border-border/60 bg-surface p-6 text-sm text-muted-foreground">
          No driver profile is linked to your account. Please contact HarborLine dispatch.
        </div>
      </DriverShell>
    );
  }

  const p = profileQ.data;
  const today = assignmentsQ.data ?? [];
  const upcoming = upcomingQ.data ?? [];

  return (
    <DriverShell title="Home">
      <div className="space-y-5">
        {p && (
          <div className="rounded-2xl border border-border/60 bg-surface p-5">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Welcome</div>
            <div className="mt-1 font-display text-2xl">{p.full_name}</div>
            {p.employee_id && (
              <div className="text-xs text-muted-foreground">ID · {p.employee_id}</div>
            )}
          </div>
        )}

        {p && (
          <DriverStatusPicker value={p.availability_status} onChange={(v) => { void changeStatus(v); }} />
        )}

        {p?.vehicle && (
          <div className="rounded-2xl border border-border/60 bg-surface p-5">
            <div className="flex items-center gap-3">
              <Car className="h-5 w-5 text-gold" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Assigned vehicle</div>
                <div className="truncate text-sm">
                  {p.vehicle.model_year ? `${p.vehicle.model_year} ` : ""}{p.vehicle.name}
                  {p.vehicle.license_plate ? ` · ${p.vehicle.license_plate}` : ""}
                </div>
              </div>
            </div>
          </div>
        )}

        <Section title={`Today's assignments (${today.length})`}>
          {today.length === 0 ? (
            <Empty>No trips scheduled for today.</Empty>
          ) : (
            today.map((a: any) => <AssignmentRow key={a.id} a={a} />)
          )}
        </Section>

        <Section title={`Upcoming (${upcoming.length})`}>
          {upcoming.length === 0 ? (
            <Empty>No upcoming trips.</Empty>
          ) : (
            upcoming.slice(0, 5).map((a: any) => <AssignmentRow key={a.id} a={a} />)
          )}
        </Section>
      </div>
    </DriverShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-white/[0.02] p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function AssignmentRow({ a }: { a: any }) {
  const b = a.bookings;
  return (
    <Link
      to="/driver/trips/$id"
      params={{ id: a.id }}
      className="flex items-center justify-between rounded-xl border border-border/60 bg-surface p-4 hover:bg-white/5"
    >
      <div className="min-w-0">
        <div className="truncate text-sm">{b?.pickup} → {b?.dropoff}</div>
        <div className="text-xs text-muted-foreground">
          {b?.pickup_time ? new Date(b.pickup_time).toLocaleString() : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={a.dispatch_status}>{String(a.dispatch_status).replace("_", " ")}</StatusPill>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );
}
// touch
