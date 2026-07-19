import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { HarborLogo } from "@/components/HarborLogo";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

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
        toast.success("Account created. You're in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
        toast.success("Welcome back.");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/book` },
      });
      if (error) throw error;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-obsidian flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <Link to="/" className="flex flex-col items-center gap-3 mb-10">
          <HarborLogo className="h-14 w-14" />
          <div className="text-center">
            <div className="font-display text-2xl text-gradient-gold">HarborLine</div>
            <div className="text-[9px] tracking-[0.4em] text-muted-foreground mt-0.5">EXECUTIVE SERVICES</div>
          </div>
        </Link>

        <div className="rounded-xl border border-border/60 bg-surface-elevated shadow-luxe p-8">
          <h1 className="font-display text-2xl mb-1">{mode === "signin" ? t("cta.signin") : t("cta.signup")}</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "signin" ? t("auth.need") : t("auth.have")}{" "}
            <button className="text-gold underline-offset-4 hover:underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
              {mode === "signin" ? t("cta.signup") : t("cta.signin")}
            </button>
          </p>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder={t("auth.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm outline-none focus:border-gold" />
                <input required placeholder={t("auth.surname")} value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} className="rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm outline-none focus:border-gold" />
              </div>
            )}
            <input required type="email" placeholder={t("auth.email")} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm outline-none focus:border-gold" />
            <input required type="password" placeholder={t("auth.password")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm outline-none focus:border-gold" />
            {mode === "signup" && (
              <input placeholder={t("auth.phone")} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm outline-none focus:border-gold" />
            )}
            <button disabled={busy} type="submit" className="w-full rounded-md bg-gold-gradient py-3 text-sm font-semibold text-primary-foreground shadow-gold disabled:opacity-60">
              {busy ? "…" : mode === "signin" ? t("cta.signin") : t("auth.create")}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /><span>OR</span><div className="h-px flex-1 bg-border" />
          </div>

          <button onClick={google} disabled={busy} className="w-full rounded-md border border-border/60 bg-background hover:border-gold py-3 text-sm font-medium disabled:opacity-60">
            {t("cta.google")}
          </button>
        </div>
      </div>
    </main>
  );
}
