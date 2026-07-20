import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/ops/StatusPill";

interface Row {
  id: string; name: string; license_plate: string; status: string;
  insurance_expires_at: string | null; registration_expires_at: string | null; inspection_expires_at: string | null;
  min_expiry: string | null;
}

function pill(date: string | null) {
  if (!date) return <span className="text-muted-foreground text-xs">—</span>;
  const days = Math.floor((new Date(date).getTime() - Date.now()) / 86400000);
  const tone = days < 0 ? "cancelled" : days <= 30 ? "maintenance" : "active";
  const label = days < 0 ? `Expired ${Math.abs(days)}d` : `${days}d left`;
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

export function FleetExpirations() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    (async () => {
      setBusy(true);
      const { data } = await (supabase as any).rpc("admin_fleet_expirations");
      setRows((data ?? []) as Row[]);
      setBusy(false);
    })();
  }, []);
  if (busy) return <div className="text-sm text-muted-foreground">Loading fleet…</div>;
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-3">Vehicle</th>
            <th className="text-left px-4 py-3">Plate</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Insurance</th>
            <th className="text-left px-4 py-3">Registration</th>
            <th className="text-left px-4 py-3">Inspection</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(v => (
            <tr key={v.id} className="border-t border-border/40">
              <td className="px-4 py-3">{v.name}</td>
              <td className="px-4 py-3 text-xs tabular-nums">{v.license_plate}</td>
              <td className="px-4 py-3"><StatusPill tone={v.status as any}>{v.status}</StatusPill></td>
              <td className="px-4 py-3">{pill(v.insurance_expires_at)}</td>
              <td className="px-4 py-3">{pill(v.registration_expires_at)}</td>
              <td className="px-4 py-3">{pill(v.inspection_expires_at)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground text-sm">No vehicles on file.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
