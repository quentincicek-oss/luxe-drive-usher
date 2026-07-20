import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listActiveAmenities } from "@/lib/amenities.functions";
import { Check } from "lucide-react";

export type AmenityOption = {
  id: string; code: string; name: string; description: string | null;
  price_delta_cents: number; complimentary: boolean;
  category_name: string | null; allowed_ride_types: string[];
};

type Props = {
  rideType: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

export function AmenitiesSelector({ rideType, selectedIds, onChange }: Props) {
  const [amenities, setAmenities] = useState<AmenityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const listFn = useServerFn(listActiveAmenities);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listFn({ data: { rideType } })
      .then((rows) => { if (!cancelled) setAmenities((rows ?? []) as unknown as AmenityOption[]); })
      .catch(() => { if (!cancelled) setAmenities([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rideType, listFn]);

  const toggle = (id: string) => {
    const set = new Set(selectedIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange([...set]);
  };

  const addCents = amenities
    .filter((a) => selectedIds.includes(a.id) && !a.complimentary)
    .reduce((s, a) => s + a.price_delta_cents, 0);

  if (loading) return <div className="text-xs text-muted-foreground">Loading refreshments…</div>;
  if (amenities.length === 0) return null;

  return (
    <div>
      <div className="label-luxe">Vehicle preferences &amp; refreshments</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {amenities.map((a) => {
          const on = selectedIds.includes(a.id);
          return (
            <button key={a.id} type="button" onClick={() => toggle(a.id)}
              className={"text-left rounded-lg border p-3 transition " + (
                on ? "border-gold bg-surface/60" : "border-border/60 bg-surface/30 hover:border-gold/40"
              )}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{a.name}</div>
                  {a.description && <div className="text-[11px] text-muted-foreground mt-0.5">{a.description}</div>}
                </div>
                <div className="text-right shrink-0">
                  {a.complimentary
                    ? <span className="text-[10px] uppercase tracking-widest text-emerald-400">Complimentary</span>
                    : <span className="text-sm text-gold tabular-nums">+${(a.price_delta_cents / 100).toFixed(2)}</span>}
                </div>
              </div>
              {on && <div className="mt-2 flex items-center gap-1 text-[10px] uppercase tracking-widest text-gold"><Check className="h-3 w-3" /> Selected</div>}
            </button>
          );
        })}
      </div>
      {addCents > 0 && (
        <div className="mt-2 text-xs text-muted-foreground">
          Additional refreshments: <span className="text-gold tabular-nums">+${(addCents / 100).toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
