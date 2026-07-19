import { Link, useRouterState } from "@tanstack/react-router";
import { Home, ListChecks, FileText, User } from "lucide-react";
import { OfflineBanner } from "./OfflineBanner";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const TABS = [
  { to: "/driver",           label: "Home",  icon: Home },
  { to: "/driver/trips",     label: "Trips", icon: ListChecks },
  { to: "/driver/documents", label: "Docs",  icon: FileText },
  { to: "/driver/profile",   label: "Me",    icon: User },
] as const;

export function DriverShell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-dvh bg-background pb-[calc(env(safe-area-inset-bottom)+80px)]">
      <OfflineBanner />
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">HarborLine · Driver</div>
          <div className="font-display text-lg">{title}</div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/40 bg-background/95 backdrop-blur-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid max-w-3xl grid-cols-4">
          {TABS.map(({ to, label, icon: Icon }) => {
            const active = to === "/driver" ? pathname === "/driver" : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-3 text-[11px] transition",
                  active ? "text-gold" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
