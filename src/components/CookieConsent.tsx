import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { CURRENT_LEGAL_VERSIONS } from "@/lib/legal.functions";

/**
 * GDPR-style cookie consent banner.
 *
 * - Categories: essential (always on), analytics, marketing.
 * - Preference persists in localStorage under `harborline.cookieConsent.v1`.
 * - Also logs to `public.cookie_consents` (RLS: anon/auth insert allowed).
 * - Banner is dismissed once a decision is recorded; user can revisit via
 *   the "Cookie preferences" link in the footer / legal pages.
 */

const STORAGE_KEY = "harborline.cookieConsent.v1";
const SESSION_KEY_STORAGE = "harborline.cookieConsent.session.v1";

type Categories = { essential: true; analytics: boolean; marketing: boolean };
type Stored = { categories: Categories; version: string; grantedAt: string };

function loadStored(): Stored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (parsed.version !== CURRENT_LEGAL_VERSIONS.cookies) return null;
    return parsed;
  } catch { return null; }
}

function getSessionKey(): string {
  if (typeof window === "undefined") return "ssr";
  let key = window.localStorage.getItem(SESSION_KEY_STORAGE);
  if (!key) {
    key = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY_STORAGE, key);
  }
  return key;
}

export function getCookieConsent(): Categories | null {
  return loadStored()?.categories ?? null;
}

export function CookieConsent() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    // Open if no decision recorded for the current policy version.
    if (!loadStored()) setOpen(true);
    const listener = () => { setCustomizing(true); setOpen(true); };
    window.addEventListener("harborline:open-cookie-preferences", listener);
    return () => window.removeEventListener("harborline:open-cookie-preferences", listener);
  }, []);

  async function persist(categories: Categories) {
    const record: Stored = {
      categories,
      version: CURRENT_LEGAL_VERSIONS.cookies,
      grantedAt: new Date().toISOString(),
    };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* ignore */ }

    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("cookie_consents").insert({
      user_id: userData?.user?.id ?? null,
      session_key: getSessionKey(),
      categories: categories as unknown as Record<string, boolean>,
      policy_ver: CURRENT_LEGAL_VERSIONS.cookies,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : null,
    });
    setOpen(false);
    setCustomizing(false);
    window.dispatchEvent(new CustomEvent("harborline:cookie-consent-updated", { detail: categories }));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[80] px-3 pb-3 sm:px-6 sm:pb-6" role="dialog" aria-live="polite" aria-label={t("cookies.banner.title")}>
      <div className="mx-auto max-w-3xl rounded-2xl border border-gold/40 bg-obsidian/95 p-4 shadow-luxe backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex-1 text-sm text-muted-foreground">
            <div className="mb-1 font-display text-base text-gradient-gold">{t("cookies.banner.title")}</div>
            <p className="leading-relaxed">
              {t("cookies.banner.body")}{" "}
              <Link to="/legal/cookies" className="text-gold underline">{t("cookies.banner.learn")}</Link>
              {" · "}
              <Link to="/legal/privacy" className="text-gold underline">{t("legal.privacy.title")}</Link>
            </p>

            {customizing && (
              <div className="mt-3 space-y-2 text-xs">
                <label className="flex items-center gap-2 opacity-60">
                  <input type="checkbox" checked readOnly /> {t("cookies.cat.essential")}
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} /> {t("cookies.cat.analytics")}
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> {t("cookies.cat.marketing")}
                </label>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:min-w-[10rem]">
            <button
              type="button"
              onClick={() => persist({ essential: true, analytics: true, marketing: true })}
              className="btn-primary-luxe justify-center whitespace-nowrap"
            >
              {t("cookies.accept_all")}
            </button>
            <button
              type="button"
              onClick={() => persist({ essential: true, analytics: false, marketing: false })}
              className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground hover:border-gold hover:text-foreground"
            >
              {t("cookies.reject_optional")}
            </button>
            {customizing ? (
              <button
                type="button"
                onClick={() => persist({ essential: true, analytics, marketing })}
                className="rounded-md border border-gold/50 px-3 py-2 text-xs text-gold hover:bg-gold/10"
              >
                {t("cookies.save_prefs")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCustomizing(true)}
                className="text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                {t("cookies.customize")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Programmatic opener used by footer / legal pages. */
export function openCookiePreferences() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("harborline:open-cookie-preferences"));
}
