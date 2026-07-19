import { useState } from "react";
import { SUPPORTED, useI18n, type Lang } from "@/lib/i18n";

export function LanguageMenu({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = SUPPORTED.find((s) => s.code === lang);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("cta.language")}
        onClick={() => setOpen((x) => !x)}
        className="rounded-full border border-border/70 bg-background/50 backdrop-blur px-4 py-2 text-xs uppercase tracking-widest hover:border-gold transition"
      >
        {compact ? selected?.code.toUpperCase() : selected?.label}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-44 rounded-md border border-border bg-popover shadow-luxe p-1 z-50">
          {SUPPORTED.map((s) => (
            <button
              type="button"
              key={s.code}
              onClick={() => {
                setLang(s.code as Lang);
                setOpen(false);
              }}
              className={"block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent " + (s.code === lang ? "text-gold" : "")}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}