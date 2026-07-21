import { createFileRoute, Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { CURRENT_LEGAL_VERSIONS } from "@/lib/legal.functions";

export const Route = createFileRoute("/legal/terms")({
  head: () => ({
    meta: [
      { title: "HarborLine Executive Services — Terms of Service" },
      { name: "description", content: "Terms of Service governing the HarborLine Executive Services premium concierge ride platform." },
      { property: "og:title", content: "HarborLine — Terms of Service" },
      { property: "og:description", content: "Terms governing use of HarborLine Executive Services." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  const { t } = useI18n();
  return (
    <LegalShell title={t("legal.terms.title")} version={CURRENT_LEGAL_VERSIONS.terms}>
      <p>{t("legal.terms.p1")}</p>
      <h2>{t("legal.terms.h_service")}</h2>
      <p>{t("legal.terms.p_service")}</p>
      <h2>{t("legal.terms.h_conduct")}</h2>
      <p>{t("legal.terms.p_conduct")}</p>
      <h2>{t("legal.terms.h_payment")}</h2>
      <p>{t("legal.terms.p_payment")}</p>
      <h2>{t("legal.terms.h_liability")}</h2>
      <p>{t("legal.terms.p_liability")}</p>
      <h2>{t("legal.terms.h_contact")}</h2>
      <p>{t("legal.terms.p_contact")}</p>
    </LegalShell>
  );
}

export function LegalShell({ title, version, children }: { title: string; version: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="min-h-dvh bg-obsidian px-4 py-16 text-foreground">
      <article className="mx-auto max-w-3xl">
        <nav className="mb-8 text-xs text-muted-foreground">
          <Link to="/" className="text-gold hover:underline">← {t("legal.back_home")}</Link>
        </nav>
        <h1 className="mb-2 font-display text-4xl text-gradient-gold">{title}</h1>
        <div className="mb-8 text-xs uppercase tracking-[0.25em] text-muted-foreground">
          {t("legal.version")} {version} · {t("legal.owner_note")}
        </div>
        <div className="prose prose-invert max-w-none space-y-4 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:text-foreground">
          {children}
        </div>
        <div className="mt-12 flex flex-wrap gap-4 border-t border-border/40 pt-6 text-xs text-muted-foreground">
          <Link to="/legal/terms" className="hover:text-gold">{t("legal.terms.title")}</Link>
          <Link to="/legal/privacy" className="hover:text-gold">{t("legal.privacy.title")}</Link>
          <Link to="/legal/dpa" className="hover:text-gold">{t("legal.dpa.title")}</Link>
          <Link to="/legal/cookies" className="hover:text-gold">{t("legal.cookies.title")}</Link>
        </div>
      </article>
    </main>
  );
}
