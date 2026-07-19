import { Link } from "@tanstack/react-router";
import { HarborLogo } from "@/components/HarborLogo";
import { LanguageMenu } from "@/components/LanguageMenu";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { History, LogOut, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

type Props = { subtitle?: string; right?: ReactNode };

export function AppHeader({ subtitle, right }: Props) {
  const { role, signOut } = useAuth();
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 sm:px-6 py-3.5">
        <Link to="/" className="flex min-w-0 items-center gap-3 focus-luxe">
          <HarborLogo className="h-9 w-9 shrink-0" />
          <div className="min-w-0 leading-tight">
            <div className="font-display text-base sm:text-lg text-gradient-gold truncate">HarborLine</div>
            <div className="text-[8px] tracking-[0.3em] text-muted-foreground uppercase truncate">
              {subtitle ?? t("brand.services")}
            </div>
          </div>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <LanguageMenu compact />
          {right}
          <Link to="/history" className="btn-ghost-luxe" aria-label={t("nav.history")}>
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">{t("nav.history")}</span>
          </Link>
          {role === "admin" && (
            <Link to="/admin" className="btn-ghost-luxe text-gold" aria-label={t("nav.admin")}>
              <ShieldCheck className="h-4 w-4" />
              <span className="hidden sm:inline">{t("nav.admin")}</span>
            </Link>
          )}
          <button onClick={signOut} className="btn-ghost-luxe" aria-label={t("nav.signout")}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t("nav.signout")}</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
