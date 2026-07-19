import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { DriverShell } from "@/components/driver/DriverShell";
import { StatusPill } from "@/components/ops/StatusPill";
import { ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/_driver/trips")({
  component: TripsList,
});

function TripsList() {
  const { user } = useAuth();

  const q = useQuery({
    queryKey: ["driver", "trips", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: profile } = await (supabase as any)
        .from("driver_profiles").select("id").eq("user_id", user!.id).maybeSingle();
      if (!profile) return [];
      const { data } = await (supabase as any)
        .from("booking_assignments")
        .select("id, dispatch_status, is_current, bookings:booking_id(pickup, dropoff, pickup_time)")
        .eq("driver_id", profile.id)
        .order("id", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const trips = q.data ?? [];

  return (
    <DriverShell title="Trips">
      <div className="space-y-2">
        {trips.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/60 bg-white/[0.02] p-6 text-center text-sm text-muted-foreground">
            No assignments yet.
          </div>
        )}
        {trips.map((a: any) => (
          <Link
            key={a.id}
            to="/driver/trips/$id"
            params={{ id: a.id }}
            className="flex items-center justify-between rounded-xl border border-border/60 bg-surface p-4 hover:bg-white/5"
          >
            <div className="min-w-0">
              <div className="truncate text-sm">{a.bookings?.pickup} → {a.bookings?.dropoff}</div>
              <div className="text-xs text-muted-foreground">
                {a.bookings?.pickup_time ? new Date(a.bookings.pickup_time).toLocaleString() : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill tone={a.dispatch_status}>{String(a.dispatch_status).replace("_", " ")}</StatusPill>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Link>
        ))}
      </div>
    </DriverShell>
  );
}
// touch
