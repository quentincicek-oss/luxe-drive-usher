// HarborLine analytics abstraction.
// Only records events after the user has granted the "analytics" cookie
// category. Reads consent from localStorage (mirror of cookie_consents).

import { supabase } from "@/integrations/supabase/client";

type Props = Record<string, unknown>;

const CONSENT_KEY = "harborline.cookie_consent.v1";
const SESSION_KEY = "harborline.analytics.session";

type StoredConsent = {
  version: string;
  categories: { essential: boolean; analytics: boolean; marketing: boolean };
};

function readConsent(): StoredConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    return raw ? (JSON.parse(raw) as StoredConsent) : null;
  } catch { return null; }
}

export function analyticsAllowed(): boolean {
  return !!readConsent()?.categories?.analytics;
}

function sessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let s = window.sessionStorage.getItem(SESSION_KEY);
    if (!s) {
      s = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
      window.sessionStorage.setItem(SESSION_KEY, s);
    }
    return s;
  } catch { return String(Date.now()); }
}

export async function track(name: string, props: Props = {}) {
  if (!analyticsAllowed()) return;
  const consent = readConsent();
  try {
    await supabase.from("analytics_events").insert({
      name: name.slice(0, 128),
      props: props as never,
      session_id: sessionId(),
      consent_version: consent?.version ?? null,
    });
  } catch {
    // Never throw from analytics
  }
}

export function page(path: string, title?: string) {
  return track("page_view", { path, title });
}
