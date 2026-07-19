import { createFileRoute, Outlet, redirect, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/driver")({
  ssr: false,
  beforeLoad: () => {
    // Client-side redirect for unauthenticated; role gate rendered in component.
    if (typeof window === "undefined") return;
  },
  component: DriverLayout,
});

function DriverLayout() {
  const { session, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!session) {
    throw redirect({ to: "/auth" });
  }

  if (role !== "driver" && role !== "admin") {
    return <AccessDenied />;
  }

  return <Outlet />;
}

function AccessDenied() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="max-w-md space-y-5 rounded-2xl border border-border/60 bg-surface p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-500/10 text-rose-300">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div>
          <div className="font-display text-2xl">Access restricted</div>
          <p className="mt-2 text-sm text-muted-foreground">
            The HarborLine Driver Application is available only to approved chauffeurs.
            If you believe this is an error, please contact your dispatcher.
          </p>
        </div>
        <Link to="/" className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-gold-gradient px-6 text-sm font-medium text-primary-foreground">
          Return home
        </Link>
      </div>
    </div>
  );
}
// touch
