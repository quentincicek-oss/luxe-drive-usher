import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { CURRENT_LEGAL_VERSIONS } from "@/lib/legal.functions";
import { LegalShell } from "./legal.terms";

export const Route = createFileRoute("/legal/dpa")({
  head: () => ({
    meta: [
      { title: "HarborLine Executive Services — Data Processing Addendum" },
      { name: "description", content: "Data Processing Addendum for HarborLine Executive Services enterprise engagements." },
      { property: "og:title", content: "HarborLine — Data Processing Addendum" },
      { property: "og:description", content: "Processor terms for HarborLine Executive Services." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => {
    const { t } = useI18n();
    return (
      <LegalShell title={t("legal.dpa.title")} version={CURRENT_LEGAL_VERSIONS.dpa}>
        <p>{t("legal.dpa.p1")}</p>
        <h2>{t("legal.dpa.h_roles")}</h2>
        <p>{t("legal.dpa.p_roles")}</p>
        <h2>{t("legal.dpa.h_sub")}</h2>
        <p>{t("legal.dpa.p_sub")}</p>
        <h2>{t("legal.dpa.h_sec")}</h2>
        <p>{t("legal.dpa.p_sec")}</p>
        <h2>{t("legal.dpa.h_intl")}</h2>
        <p>{t("legal.dpa.p_intl")}</p>
        <h2>{t("legal.dpa.h_contact")}</h2>
        <p>{t("legal.dpa.p_contact")}</p>
      </LegalShell>
    );
  },
});
