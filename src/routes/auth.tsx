import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { HarborLogo } from "@/components/HarborLogo";
import { LanguageMenu } from "@/components/LanguageMenu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Field } from "@/components/ui/Field";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign In — HarborLine Executive Services" },
      { name: "description", content: "Access your HarborLine concierge account." },
    ],
  }),
  component: Auth,
});

function Auth() {
  const nav = useNavigate();
  const { t } = useI18n();
  const { user, role, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", surname: "", phone: "" });

  useEffect(() => { document.title = `${mode === "signin" ? t("cta.signin") : t("cta.signup")} — ${t("brand.name")}`; }, [mode, t]);

  useEffect(() => {
    if (!loading && user) {
      nav({ to: role === "admin" ? "/admin" : "/book" });
    }
  }, [user, role, loading, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            emailRedirectTo: `${window.location.origin}/book`,
            data: { name: form.name, surname: form.surname, phone: form.phone },
          },
        });
        if (error) throw error;
        toast.success(t("auth.created"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
        toast.success(t("auth.welcome"));
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("auth.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    try {
      const { lovable } = await import("@/integrations/lovable/index");
      const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (result.error) throw new Error((result.error as Error).message || t("auth.googleFailed"));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("auth.googleFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-obsidian flex items-center justify-center px-5 py-10 sm:py-16">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-end">
          <LanguageMenu />
        </div>
        <Link to="/" className="flex flex-col items-center gap-3 mb-8">
          <HarborLogo className="h-14 w-14" />
          <div className="text-center">
            <div className="font-display text-2xl text-gradient-gold">HarborLine</div>
            <div className="text-[9px] tracking-[0.4em] text-muted-foreground mt-0.5 uppercase">{t("brand.services")}</div>
          </div>
        </Link>

        <div className="card-luxe p-6 sm:p-8">
          <h1 className="font-display text-2xl mb-1">{mode === "signin" ? t("cta.signin") : t("cta.signup")}</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "signin" ? t("auth.need") : t("auth.have")}{" "}
            <button className="text-gold underline-offset-4 hover:underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
              {mode === "signin" ? t("cta.signup") : t("cta.signin")}
            </button>
          </p>

          <button
            onClick={google}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border/60 bg-background hover:border-gold py-3 text-sm font-medium disabled:opacity-60 min-h-11"
          >
            <GoogleGlyph /> {t("cta.google")}
          </button>

          <div className="my-5 flex items-center gap-3 text-[11px] tracking-widest text-muted-foreground uppercase">
            <div className="h-px flex-1 bg-border" /><span>{t("auth.or")}</span><div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("auth.name")} required autoComplete="given-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <Field label={t("auth.surname")} required autoComplete="family-name" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} />
              </div>
            )}
            <Field label={t("auth.email")} required type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Field label={t("auth.password")} required type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            {mode === "signup" && (
              <Field label={t("auth.phone")} type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            )}
            <button disabled={busy} type="submit" className="btn-primary-luxe w-full">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? t("cta.signin") : t("auth.create")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.9 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41 35.8 44 30.4 44 24c0-1.2-.1-2.3-.4-3.5z"/>
    </svg>
  );
}
