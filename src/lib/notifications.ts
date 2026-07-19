// Notification event bus for future driver-app + push integration.
// Currently adapts to toast; transport is pluggable later.
import { toast } from "sonner";

export type NotificationEvent =
  | { type: "driver.assigned"; bookingId: string; driverName: string }
  | { type: "driver.accepted"; bookingId: string; driverName: string }
  | { type: "driver.arrived"; bookingId: string }
  | { type: "trip.started"; bookingId: string }
  | { type: "trip.completed"; bookingId: string };

type Handler = (e: NotificationEvent) => void;
const handlers = new Set<Handler>();

export function subscribe(h: Handler) {
  handlers.add(h);
  return () => handlers.delete(h);
}

export function emit(e: NotificationEvent) {
  handlers.forEach((h) => {
    try { h(e); } catch { /* ignore */ }
  });
  // Default surface: toast
  const label = defaultLabel(e);
  if (label) toast.success(label);
}

function defaultLabel(e: NotificationEvent) {
  switch (e.type) {
    case "driver.assigned":  return `Driver ${e.driverName} assigned`;
    case "driver.accepted":  return `Driver ${e.driverName} accepted`;
    case "driver.arrived":   return `Driver arrived at pickup`;
    case "trip.started":     return `Trip started`;
    case "trip.completed":   return `Trip completed`;
  }
}
