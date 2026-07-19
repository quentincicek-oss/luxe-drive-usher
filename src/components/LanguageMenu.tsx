import { SUPPORTED, useI18n, type Lang } from "@/lib/i18n";
import { Globe } from "lucide-react";

export function LanguageMenu({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const selected = SUPPORTED.find((s) => s.code === lang);

  return (
    <label
      className="relative inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 backdrop-blur px-3 py-2 text-xs uppercase tracking-widest hover:border-gold transition cursor-pointer"
      aria-label={t("cta.language")}
    >
      <Globe className="h-3.5 w-3.5 text-gold" aria-hidden />
      <span className="pointer-events-none select-none">
        {compact ? selected?.code.toUpperCase() : selected?.label}
      </span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label={t("cta.language")}
      >
        {SUPPORTED.map((s) => (
          <option key={s.code} value={s.code} className="bg-background text-foreground">
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
