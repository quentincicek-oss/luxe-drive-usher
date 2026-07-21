import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { HarborLogo } from "@/components/HarborLogo";
import { LogOut, Loader2, Menu, X } from "lucide-react";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

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

function AdminLayout() {
  const { user, role, loading, roleLoading, signOut } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLogin = pathname === "/admin/login";
  const isMfa = pathname === "/admin/mfa";
  const isRecover = pathname === "/admin/recover";
  const [aalReady, setAalReady] = useState(false);
  const [aalOk, setAalOk] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (loading || roleLoading) return;
    if (isLogin || isRecover) return;
    if (!user) { nav({ to: "/admin/login", replace: true }); return; }
    if (role && role !== "admin") { nav({ to: "/admin/login", replace: true }); }
  }, [user, role, loading, roleLoading, isLogin, isRecover, nav]);

  useEffect(() => {
    if (isLogin || isMfa || isRecover) { setAalReady(true); setAalOk(true); return; }
    if (loading || roleLoading || !user || role !== "admin") return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;
      if (error) { setAalReady(true); setAalOk(false); return; }
      const ok = data?.currentLevel === "aal2";
      setAalReady(true);
      setAalOk(ok);
      if (!ok) nav({ to: "/admin/mfa", replace: true });
    })();
    return () => { cancelled = true; };
  }, [user, role, loading, roleLoading, isLogin, isMfa, isRecover, pathname, nav]);

  if (isLogin || isMfa || isRecover) return <Outlet />;

  if (loading || roleLoading || !user || role !== "admin" || !aalReady || !aalOk) {
    return (
      <div className="grid min-h-dvh place-items-center bg-obsidian text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-obsidian text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-gold/20 bg-background/80 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden -ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link to="/admin" className="flex items-center gap-2.5 focus-luxe">
              <HarborLogo className="h-8 w-8" />
              <div className="leading-tight">
                <div className="font-display text-sm text-gradient-gold">HarborLine</div>
                <div className="text-[8px] tracking-[0.35em] uppercase text-gold/70">Administrator</div>
              </div>
            </Link>
          </div>
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

      {/* Body: sidebar + content */}
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-60 shrink-0 border-r border-border/60 bg-background/40 min-h-[calc(100dvh-57px)] sticky top-[57px]">
          <AdminSidebar />
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <div className="absolute left-0 top-0 h-full w-64 bg-background border-r border-border/60 shadow-xl">
              <div className="flex items-center justify-between px-4 h-14 border-b border-border/60">
                <span className="text-xs uppercase tracking-widest text-gold/70">Menu</span>
                <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-md hover:bg-white/5" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <AdminSidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        )}

        <main id="main-content" className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
