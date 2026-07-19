// Reusable dispatch state machine for future Driver App.
// Pure client-side state; wire to server later without changing consumers.
import { useCallback, useState } from "react";
import type { DispatchStatus } from "@/components/ops/AssignmentTimeline";
import { emit } from "@/lib/notifications";

const NEXT: Record<DispatchStatus, DispatchStatus | null> = {
  pending: "assigned",
  assigned: "accepted",
  accepted: "en_route",
  en_route: "arrived",
  arrived: "in_progress",
  in_progress: "completed",
  completed: null,
  cancelled: null,
};

export function useDispatchState(initial: DispatchStatus = "assigned", bookingId = "preview", driverName = "Driver") {
  const [status, setStatus] = useState<DispatchStatus>(initial);

  const advance = useCallback(() => {
    setStatus((prev) => {
      const next = NEXT[prev];
      if (!next) return prev;
      switch (next) {
        case "accepted":     emit({ type: "driver.accepted", bookingId, driverName }); break;
        case "arrived":      emit({ type: "driver.arrived", bookingId }); break;
        case "in_progress":  emit({ type: "trip.started", bookingId }); break;
        case "completed":    emit({ type: "trip.completed", bookingId }); break;
      }
      return next;
    });
  }, [bookingId, driverName]);

  const cancel = useCallback(() => setStatus("cancelled"), []);
  const reset  = useCallback(() => setStatus(initial), [initial]);

  return { status, advance, cancel, reset };
}
