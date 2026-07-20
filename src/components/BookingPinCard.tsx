import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyBookingPin } from "@/lib/dispatch.functions";
import { KeyRound, Check } from "lucide-react";

export function BookingPinCard({ bookingId }: { bookingId: string }) {
  const fetchPin = useServerFn(getMyBookingPin);
  const q = useQuery({
    queryKey: ["booking-pin", bookingId],
    queryFn: async () => {
      const [pinRes, ver] = await Promise.all([
        fetchPin({ data: { bookingId } }).catch(() => ({ pin: null })),
        supabase.from("passenger_verifications").select("id, verified_at, method").eq("booking_id", bookingId).limit(1).maybeSingle(),
      ]);
      return { pin: pinRes.pin, verified: ver.data };
    },
    staleTime: 30_000,
  });

  if (q.data?.verified) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
        <Check className="h-4 w-4 text-emerald-400" />
        <div className="text-xs text-muted-foreground">Trip verified — safe travels.</div>
      </div>
    );
  }

  if (!q.data?.pin) return null;

  return (
    <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/10 to-transparent p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gold/90">
        <KeyRound className="h-3.5 w-3.5" /> Pickup PIN
      </div>
      <div className="mt-2 font-mono text-3xl tracking-[0.5em] text-foreground">
        {q.data.pin}
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        Share this only with your HarborLine chauffeur to begin your trip.
      </div>
    </div>
  );
}
