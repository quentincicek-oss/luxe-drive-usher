import { useTheme, type Mode } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { Sun, Moon, Wand2 } from "lucide-react";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { mode, setMode, theme } = useTheme();
  const { t } = useI18n();

  const opts: Array<{ key: Mode; label: string; icon: typeof Sun }> = [
    { key: "auto", label: t("theme.auto"), icon: Wand2 },
    { key: "day", label: t("theme.day"), icon: Sun },
    { key: "night", label: t("theme.night"), icon: Moon },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("theme.label")}
      className={"inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-background/60 backdrop-blur px-1 py-1 " + className}
      data-current-theme={theme}
    >
      {opts.map((o) => {
        const active = mode === o.key;
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(o.key)}
            title={o.label}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide transition " +
              (active
                ? "bg-gold-gradient text-primary-foreground shadow-gold"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
