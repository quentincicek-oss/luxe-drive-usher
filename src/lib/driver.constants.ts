import type { DispatchStatus } from "@/components/ops/AssignmentTimeline";

// Feature flag: passenger verification (PIN/NFC/QR) is UI-only for now.
export const VERIFICATION_REQUIRED = false;

// Full driver workflow ladder (10 conceptual steps). We map "reviewed" and
// "archived" to UI-only phases; server-side status lives in dispatch_status.
export const DRIVER_WORKFLOW: {
  key: string;
  labelKey: string;
  status?: DispatchStatus;
}[] = [
  { key: "new",         labelKey: "driver.step.new" },
  { key: "reviewed",    labelKey: "driver.step.reviewed" },
  { key: "accepted",    labelKey: "driver.step.accepted",   status: "accepted" },
  { key: "navigating",  labelKey: "driver.step.navigating", status: "en_route" },
  { key: "arrived",     labelKey: "driver.step.arrived",    status: "arrived" },
  { key: "waiting",     labelKey: "driver.step.waiting",    status: "arrived" },
  { key: "verified",    labelKey: "driver.step.verified" },
  { key: "started",     labelKey: "driver.step.started",    status: "in_progress" },
  { key: "completed",   labelKey: "driver.step.completed",  status: "completed" },
  { key: "archived",    labelKey: "driver.step.archived" },
];

export const DRIVER_AVAILABILITY: {
  value: "available" | "assigned" | "on_trip" | "offline" | "vacation";
  labelKey: string;
}[] = [
  { value: "available", labelKey: "driver.availability.available" },
  { value: "assigned",  labelKey: "driver.availability.assigned" },
  { value: "on_trip",   labelKey: "driver.availability.on_trip" },
  { value: "offline",   labelKey: "driver.availability.offline" },
  { value: "vacation",  labelKey: "driver.availability.vacation" },
];
