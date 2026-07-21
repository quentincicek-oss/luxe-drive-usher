import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { CURRENT_LEGAL_VERSIONS } from "@/lib/legal.functions";
import { LegalShell } from "./legal.terms";
import { openCookiePreferences } from "@/components/CookieConsent";

export const Route = createFileRoute("/legal/cookies")({
  head: () => ({
    meta: [
      { title: "HarborLine Executive Services — Cookie Policy" },
      { name: "description", content: "Cookies and tracking technologies used by HarborLine Executive Services." },
      { property: "og:title", content: "HarborLine — Cookie Policy" },
      { property: "og:description", content: "How HarborLine uses cookies." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => {
    const { t } = useI18n();
    return (
      <LegalShell title={t("legal.cookies.title")} version={CURRENT_LEGAL_VERSIONS.cookies}>
        <p>{t("legal.cookies.p1")}</p>
        <h2>{t("legal.cookies.h_cats")}</h2>
        <p>{t("legal.cookies.p_cats")}</p>
        <h2>{t("legal.cookies.h_choices")}</h2>
        <p>{t("legal.cookies.p_choices")}</p>
        <p>
          <button
            type="button"
            onClick={openCookiePreferences}
            className="mt-2 rounded-md border border-gold/60 px-4 py-2 text-xs text-gold hover:bg-gold/10"
          >
            {t("cookies.customize")}
          </button>
        </p>
      </LegalShell>
    );
  },
});
