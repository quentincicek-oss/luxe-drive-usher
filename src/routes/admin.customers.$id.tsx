import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/ops/StatusPill";
import { ArrowLeft, User, Phone, Mail, MapPin, History } from "lucide-react";

export const Route = createFileRoute("/admin/customers/$id")({
  head: () => ({ meta: [{ title: "Customer — HarborLine Admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: CustomerDetail,
});

function CustomerDetail() {
  const { id } = Route.useParams();
  const [profile, setProfile] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      const [p, b] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
        supabase.from("bookings").select("id, pickup, dropoff, pickup_time, status, paid, price, suggested_price").eq("passenger_id", id).order("pickup_time", { ascending: false }).limit(100),
      ]);
      if (!alive) return;
      setProfile(p.data ?? null);
      setBookings((b.data ?? []) as any[]);
      setBusy(false);
    })();
    return () => { alive = false; };
  }, [id]);

  if (busy) return <div className="text-muted-foreground text-sm">Loading customer…</div>;
  if (!profile) return (
    <div className="max-w-md mx-auto text-center py-16">
      <p className="text-muted-foreground text-sm">Customer not found.</p>
      <Link to="/admin/customers" className="mt-4 inline-flex items-center gap-2 text-sm text-gold hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to customers
      </Link>
    </div>
  );

  const name = `${profile.name ?? ""} ${profile.surname ?? ""}`.trim() || (profile.email ?? "—");
  const current = bookings.find(b => b.status !== "completed" && b.status !== "cancelled");

  return (
    <div className="space-y-6">
      <Link to="/admin/customers" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All customers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">Customer</div>
          <h1 className="font-display text-3xl mt-1">{name}</h1>
          <div className="mt-2 text-sm text-muted-foreground">Joined {new Date(profile.created_at).toLocaleDateString()}</div>
        </div>
        <div>
          {profile.is_suspended
            ? <StatusPill tone="cancelled">Suspended</StatusPill>
            : <StatusPill tone="active">Active</StatusPill>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Contact" icon={<User className="h-4 w-4" />}>
          <div className="text-sm space-y-2">
            <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> <span>{profile.email ?? "—"}</span></div>
            <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> <span>{profile.phone ?? "—"}</span></div>
            <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground" /> <span>{profile.home_address ?? "—"}</span></div>
            {profile.preferred_language && <div className="text-xs text-muted-foreground">Language: {profile.preferred_language}</div>}
          </div>
        </Section>

        <Section title="Current booking" icon={<MapPin className="h-4 w-4" />}>
          {current ? (
            <div className="text-sm space-y-1.5">
              <div>{current.pickup} <span className="text-gold mx-1">→</span> {current.dropoff}</div>
              <div className="text-xs text-muted-foreground">{new Date(current.pickup_time).toLocaleString()}</div>
              <StatusPill tone={current.status as any}>{current.status.replace("_", " ")}</StatusPill>
              <div className="pt-2">
                <Link to="/admin/trips/$id" params={{ id: current.id }} className="text-xs text-gold hover:underline">Open trip →</Link>
              </div>
            </div>
          ) : <div className="text-sm text-muted-foreground">No active booking.</div>}
        </Section>

        <Section title="Notes" icon={<User className="h-4 w-4" />}>
          <div className="text-sm text-muted-foreground">
            {profile.is_test_account && <div className="text-amber-300 text-xs uppercase tracking-widest mb-1">Test account</div>}
            No customer notes.
          </div>
        </Section>
      </div>

      <Section title="Booking history" icon={<History className="h-4 w-4" />}>
        {bookings.length === 0 ? (
          <div className="text-sm text-muted-foreground">No bookings yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="text-left py-2">When</th>
                  <th className="text-left py-2">Route</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-left py-2">Paid</th>
                  <th className="text-left py-2">Price</th>
                  <th className="text-right py-2"></th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(b => (
                  <tr key={b.id} className="border-t border-border/40">
                    <td className="py-2 text-xs tabular-nums whitespace-nowrap">{new Date(b.pickup_time).toLocaleString()}</td>
                    <td className="py-2">{b.pickup} <span className="text-gold mx-1">→</span> {b.dropoff}</td>
                    <td className="py-2"><StatusPill tone={b.status as any}>{b.status.replace("_", " ")}</StatusPill></td>
                    <td className="py-2"><StatusPill tone={b.paid ? "paid" : "unpaid"}>{b.paid ? "Yes" : "No"}</StatusPill></td>
                    <td className="py-2 text-gold tabular-nums">${Number(b.price ?? b.suggested_price ?? 0).toFixed(0)}</td>
                    <td className="py-2 text-right">
                      <Link to="/admin/trips/$id" params={{ id: b.id }} className="text-xs text-gold hover:underline">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
