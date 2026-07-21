// Public liveness endpoint. Returns 200 with build/service info.
// Does NOT touch the database — used by uptime pings.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          status: "ok",
          service: "harborline",
          time: new Date().toISOString(),
        });
      },
    },
  },
});
