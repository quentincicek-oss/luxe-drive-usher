import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { reportIncident } from "@/lib/trust.functions";
import { toast } from "sonner";
import { X, AlertTriangle } from "lucide-react";

const CATEGORIES: Array<{ value: any; label: string }> = [
  { value: "vehicle", label: "Vehicle issue" },
  { value: "passenger", label: "Passenger issue" },
  { value: "traffic", label: "Traffic incident" },
  { value: "road_closure", label: "Road closure" },
  { value: "lost_property", label: "Lost property" },
  { value: "emergency", label: "Emergency" },
  { value: "other", label: "Other" },
];
const SEVERITIES: Array<{ value: any; label: string }> = [
  { value: "low", label: "Low" }, { value: "medium", label: "Medium" },
  { value: "high", label: "High" }, { value: "critical", label: "Critical" },
];

export function IncidentModal({
  bookingId, onClose, onDone,
}: { bookingId?: string; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState<any>("other");
  const [severity, setSeverity] = useState<any>("medium");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = useServerFn(reportIncident);

  async function go() {
    if (description.trim().length < 3) { toast.error("Please describe the incident"); return; }
    setBusy(true);
    try {
      await submit({ data: { bookingId, category, severity, description: description.trim() } });
      toast.success("Incident reported to dispatch");
      onDone();
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-border/60 bg-surface p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-400" /><h2 className="font-display text-lg">Report Incident</h2></div>
          <button onClick={onClose} className="p-2 -m-2"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-xl border border-border/60 bg-white/[0.02] px-3 py-3 text-sm">
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Severity</label>
          <div className="grid grid-cols-4 gap-2">
            {SEVERITIES.map(s => (
              <button key={s.value} onClick={() => setSeverity(s.value)}
                className={`rounded-xl border py-2 text-xs ${severity === s.value ? "border-gold bg-gold/10" : "border-border/60"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
            className="w-full rounded-xl border border-border/60 bg-white/[0.02] p-3 text-sm"
            placeholder="What happened?"
          />
        </div>

        <button onClick={go} disabled={busy}
          className="w-full min-h-[52px] rounded-full bg-gold-gradient text-sm font-medium text-primary-foreground shadow-gold disabled:opacity-50">
          {busy ? "Submitting…" : "Submit Incident"}
        </button>
      </div>
    </div>
  );
}
