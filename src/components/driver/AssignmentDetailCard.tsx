import { Clock, Users, Plane, StickyNote, Coffee, Accessibility, Car } from "lucide-react";
import { DestinationLine } from "./NavigateSheet";

type Row = { icon: typeof Clock; label: string; value: string };

export function AssignmentDetailCard({
  passengerFirstName,
  pickup,
  dropoff,
  pickupTime,
  passengers,
  flight,
  notes,
  refreshments,
  accommodations,
  vehicleLabel,
  estimatedDuration,
}: {
  passengerFirstName: string;
  pickup: string;
  dropoff: string;
  pickupTime: string;
  passengers: number;
  flight?: string | null;
  notes?: string | null;
  refreshments?: string | null;
  accommodations?: string | null;
  vehicleLabel?: string | null;
  estimatedDuration?: string | null;
}) {
  const rows: Row[] = [
    { icon: Clock, label: "Pickup time", value: new Date(pickupTime).toLocaleString() },
    { icon: Users, label: "Passengers", value: String(passengers) },
  ];
  if (vehicleLabel) rows.push({ icon: Car, label: "Vehicle", value: vehicleLabel });
  if (estimatedDuration) rows.push({ icon: Clock, label: "Est. duration", value: estimatedDuration });
  if (flight) rows.push({ icon: Plane, label: "Flight", value: flight });
  if (refreshments) rows.push({ icon: Coffee, label: "Refreshments", value: refreshments });
  if (accommodations) rows.push({ icon: Accessibility, label: "Accommodations", value: accommodations });
  if (notes) rows.push({ icon: StickyNote, label: "Notes", value: notes });

  return (
    <div className="rounded-2xl border border-border/60 bg-surface p-5 space-y-5">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Passenger</div>
        <div className="mt-1 font-display text-lg">{passengerFirstName}</div>
      </div>
      <div className="space-y-3 border-t border-border/40 pt-4">
        <DestinationLine label="Pickup" value={pickup} />
        <DestinationLine label="Dropoff" value={dropoff} />
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-border/40 pt-4">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <r.icon className="h-3 w-3" /> {r.label}
            </dt>
            <dd className="mt-0.5 truncate text-sm">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
