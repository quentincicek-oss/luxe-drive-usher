import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { DriverShell } from "@/components/driver/DriverShell";
import { DriverStatusPicker } from "@/components/driver/DriverStatusPicker";
import { toast } from "sonner";
import { LogOut } from "lucide-react";

export const Route = createFileRoute("/_driver/profile")({
  component: DriverProfile,
});

function DriverProfile() {
  const { user, signOut } = useAuth();

  const q = useQuery({
    queryKey: ["driver", "profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("driver_profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const p = q.data;

  const changeStatus = async (v: string) => {
    if (!p?.id) return;
    const { error } = await (supabase as any)
      .from("driver_profiles").update({ availability_status: v }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Status updated");
    q.refetch();
  };

  return (
    <DriverShell title="Profile">
      <div className="space-y-5">
        {p && (
          <>
            <div className="rounded-2xl border border-border/60 bg-surface p-5">
              <div className="font-display text-xl">{p.full_name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {p.employee_id && `ID · ${p.employee_id}`}
                {p.email && ` · ${p.email}`}
                {p.phone && ` · ${p.phone}`}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <Cell label="Employment" value={p.employment_status} />
                <Cell label="Availability" value={p.availability_status} />
                {p.license_number && <Cell label="License" value={p.license_number} />}
                {p.license_expires_at && (
                  <Cell label="License exp." value={new Date(p.license_expires_at).toLocaleDateString()} />
                )}
              </div>
            </div>

            <DriverStatusPicker value={p.availability_status} onChange={changeStatus} />
          </>
        )}

        <button
          onClick={signOut}
          className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-full border border-border/60 bg-white/5 text-sm hover:bg-white/10"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </DriverShell>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="capitalize">{value}</div>
    </div>
  );
}
