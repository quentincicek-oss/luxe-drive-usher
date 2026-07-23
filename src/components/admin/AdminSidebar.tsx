import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Route as RouteIcon, Users, UserCog, Car, Activity, ScrollText, Settings, HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
const NAV: NavItem[] = [
  { to: "/admin",            label: "Dashboard",  icon: LayoutDashboard, exact: true },
  { to: "/admin/trips",      label: "Trips",      icon: RouteIcon },
  { to: "/admin/drivers",    label: "Drivers",    icon: UserCog },
  { to: "/admin/customers",  label: "Customers",  icon: Users },
  { to: "/admin/vehicles",   label: "Vehicles",   icon: Car },
  { to: "/admin/operations", label: "Operations", icon: Activity },
  { to: "/admin/policies",   label: "Policies",   icon: ScrollText },
  { to: "/admin/settings",   label: "Settings",   icon: Settings },
  { to: "/admin/health",     label: "Health",     icon: HeartPulse },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="px-3 pb-3 pt-1 text-[10px] uppercase tracking-[0.28em] text-gold/60">Operations</div>
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to as never}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
              active
                ? "bg-gold/10 text-gold ring-1 ring-inset ring-gold/25"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
