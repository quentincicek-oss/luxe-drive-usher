import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { HarborLogo } from "@/components/HarborLogo";
import { LogOut, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "HarborLine Admin" },
      { name: "description", content: "HarborLine internal operations." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLayout,
});

// Route-based independent admin application.
// Server authorization is enforced by every admin RPC (has_role check).
// This client-side gate is a UX guard — non-admins are rejected on any privileged call.
function AdminLayout() {
  const { user, role, loading, roleLoading, signOut } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLogin = pathname === "/admin/login";

  useEffect(() => {
    if (loading || roleLoading) return;
    if (isLogin) return;
    if (!user) { nav({ to: "/admin/login", replace: true }); return; }
    if (role && role !== "admin") { nav({ to: "/admin/login", replace: true }); }
  }, [user, role, loading, roleLoading, isLogin, nav]);

  if (isLogin) return <Outlet />;

  if (loading || roleLoading || !user || role !== "admin") {
    return (
      <div className="grid min-h-dvh place-items-center bg-obsidian text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-obsidian">
      <header className="sticky top-0 z-40 border-b border-gold/20 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 py-3">
          <Link to="/admin" className="flex items-center gap-2.5 focus-luxe">
            <HarborLogo className="h-8 w-8" />
            <div className="leading-tight">
              <div className="font-display text-sm text-gradient-gold">HarborLine</div>
              <div className="text-[8px] tracking-[0.35em] uppercase text-gold/70">Administrator</div>
            </div>
          </Link>
          <div className="flex items-center gap-2 text-xs">
            <span className="hidden sm:inline text-muted-foreground">{user.email}</span>
            <button
              onClick={async () => { await signOut(); nav({ to: "/admin/login", replace: true }); }}
              className="btn-ghost-luxe"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
