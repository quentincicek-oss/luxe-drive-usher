import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { CURRENT_LEGAL_VERSIONS } from "@/lib/legal.functions";
import { LegalShell } from "./legal.terms";

export const Route = createFileRoute("/legal/privacy")({
  head: () => ({
    meta: [
      { title: "HarborLine Executive Services — Privacy Policy" },
      { name: "description", content: "How HarborLine Executive Services collects, uses, and protects passenger and driver data." },
      { property: "og:title", content: "HarborLine — Privacy Policy" },
      { property: "og:description", content: "How HarborLine handles your data." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => {
    const { t } = useI18n();
    return (
      <LegalShell title={t("legal.privacy.title")} version={CURRENT_LEGAL_VERSIONS.privacy}>
        <p>{t("legal.privacy.p1")}</p>
        <h2>{t("legal.privacy.h_collect")}</h2>
        <p>{t("legal.privacy.p_collect")}</p>
        <h2>{t("legal.privacy.h_use")}</h2>
        <p>{t("legal.privacy.p_use")}</p>
        <h2>{t("legal.privacy.h_share")}</h2>
        <p>{t("legal.privacy.p_share")}</p>
        <h2>{t("legal.privacy.h_rights")}</h2>
        <p>{t("legal.privacy.p_rights")}</p>
        <h2>{t("legal.privacy.h_retention")}</h2>
        <p>{t("legal.privacy.p_retention")}</p>
        <h2>{t("legal.privacy.h_contact")}</h2>
        <p>{t("legal.privacy.p_contact")}</p>
      </LegalShell>
    );
  },
});
