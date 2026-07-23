import { createFileRoute } from "@tanstack/react-router";
import { BookingPoliciesPanel } from "@/components/admin/BookingPoliciesPanel";

export const Route = createFileRoute("/admin/policies")({
  head: () => ({
    meta: [
      { title: "Booking Policies — HarborLine Admin" },
      { name: "description", content: "Manage versioned cancellation and no-show policies." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BookingPoliciesPanel,
});
