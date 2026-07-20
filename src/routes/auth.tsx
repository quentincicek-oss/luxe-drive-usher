import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { HarborLogo } from "@/components/HarborLogo";
import { LanguageMenu } from "@/components/LanguageMenu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2, ShieldCheck, UserPlus, LogIn, Car } from "lucide-react";
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

type Mode = "passenger-signin" | "passenger-signup" | "driver-signin";

// Generic error surfaced from Driver Sign In. Never reveals whether the
// email exists, is a passenger, an admin, or has no account at all.
const DRIVER_GENERIC_ERROR =
  "Driver access is available only to accounts provisioned by HarborLine. If you believe this is an error, contact your dispatcher.";

function Auth() {
  const nav = useNavigate();
  const { t } = useI18n();
  const { user, role, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("passenger-signin");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", surname: "", phone: "" });

  useEffect(() => {
    const titles: Record<Mode, string> = {
      "passenger-signin": t("cta.signin"),
      "passenger-signup": t("cta.signup"),
      "driver-signin": "Driver Sign In",
    };
    document.title = `${titles[mode]} — ${t("brand.name")}`;
  }, [mode, t]);

  useEffect(() => {
    if (!loading && user) {
      if (role === "admin") nav({ to: "/admin" });
      else if (role === "driver") nav({ to: "/driver" });
      else nav({ to: "/book" });
    }
  }, [user, role, loading, nav]);

  async function verifyDriverOrReject(_uid: string) {
    // Server-authoritative eligibility. The SECURITY DEFINER RPC returns
    // only a boolean; the specific reason (wrong role, suspended, inactive,
    // missing profile, conflicting roles) is intentionally not surfaced.
    try {
      const { driverSignInEligibility } = await import("@/lib/mfa.functions");
      const res = await driverSignInEligibility({ data: {} });
      return res.ok === true;
    } catch {
      return false;
    }
  }

  async function handlePassengerSignUp() {
    // Public self-registration is passenger-only. handle_new_user()
    // ignores any role in metadata; we still avoid sending role-bearing
    // fields from the client. Only display/contact fields.
    const { error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/book`,
        data: {
          name: form.name.trim(),
          surname: form.surname.trim(),
          phone: form.phone.trim() || undefined,
        },
      },
    });
    if (error) throw error;
    toast.success(t("auth.created"));
  }

  async function handlePassengerSignIn() {
    const { error } = await supabase.auth.signInWithPassword({
      email: form.email.trim(),
      password: form.password,
    });
    if (error) throw error;
    toast.success(t("auth.welcome"));
  }

  async function handleDriverSignIn() {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: form.email.trim(),
      password: form.password,
    });
    if (error) {
      // Generic — do not distinguish "no such user" from "wrong password".
      throw new Error(DRIVER_GENERIC_ERROR);
    }
    const uid = data.user?.id;
    if (!uid) throw new Error(DRIVER_GENERIC_ERROR);

    const ok = await verifyDriverOrReject(uid);
    if (!ok) {
      await supabase.auth.signOut();
      throw new Error(DRIVER_GENERIC_ERROR);
    }
    toast.success(t("auth.welcome"));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "passenger-signup") await handlePassengerSignUp();
      else if (mode === "passenger-signin") await handlePassengerSignIn();
      else await handleDriverSignIn();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("auth.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    // Passenger-only social sign-in. First-time creates a passenger via
    // handle_new_user (role metadata ignored). If the resulting account
    // resolves to admin/driver server-side, role-based redirect handles it.
    setBusy(true);
    try {
      const { lovable } = await import("@/integrations/lovable/index");
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw new Error((result.error as Error).message || t("auth.googleFailed"));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("auth.googleFailed"));
    } finally {
      setBusy(false);
    }
  }

  const isDriver = mode === "driver-signin";
  const isSignup = mode === "passenger-signup";

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
            <div className="text-[9px] tracking-[0.4em] text-muted-foreground mt-0.5 uppercase">
              {t("brand.services")}
            </div>
          </div>
        </Link>

        {/* Segmented mode selector */}
        <div
          role="tablist"
          aria-label="Authentication method"
          className="mb-5 grid grid-cols-3 gap-1 rounded-full border border-border/60 bg-surface/50 p-1 text-xs"
        >
          <TabBtn active={mode === "passenger-signin"} onClick={() => setMode("passenger-signin")} icon={<LogIn className="h-3.5 w-3.5" />}>
            Passenger
          </TabBtn>
          <TabBtn active={mode === "passenger-signup"} onClick={() => setMode("passenger-signup")} icon={<UserPlus className="h-3.5 w-3.5" />}>
            Sign Up
          </TabBtn>
          <TabBtn active={mode === "driver-signin"} onClick={() => setMode("driver-signin")} icon={<Car className="h-3.5 w-3.5" />}>
            Driver
          </TabBtn>
        </div>

        <div className="card-luxe p-6 sm:p-8">
          <h1 className="font-display text-2xl mb-1">
            {isDriver ? "Driver Sign In" : isSignup ? t("cta.signup") : t("cta.signin")}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {isDriver ? (
              <span className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                <span>
                  Driver access is available only to accounts provisioned by HarborLine. There is
                  no public driver sign-up.
                </span>
              </span>
            ) : isSignup ? (
              <>
                {t("auth.have")}{" "}
                <button
                  className="text-gold underline-offset-4 hover:underline"
                  onClick={() => setMode("passenger-signin")}
                >
                  {t("cta.signin")}
                </button>
              </>
            ) : (
              <>
                {t("auth.need")}{" "}
                <button
                  className="text-gold underline-offset-4 hover:underline"
                  onClick={() => setMode("passenger-signup")}
                >
                  {t("cta.signup")}
                </button>
              </>
            )}
          </p>

          {!isDriver && (
            <>
              <button
                onClick={google}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border/60 bg-background hover:border-gold py-3 text-sm font-medium disabled:opacity-60 min-h-11"
              >
                <GoogleGlyph /> {t("cta.google")}
              </button>
              <div className="my-5 flex items-center gap-3 text-[11px] tracking-widest text-muted-foreground uppercase">
                <div className="h-px flex-1 bg-border" />
                <span>{t("auth.or")}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={submit} className="space-y-4">
            {isSignup && (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={t("auth.name")}
                  required
                  autoComplete="given-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <Field
                  label={t("auth.surname")}
                  required
                  autoComplete="family-name"
                  value={form.surname}
                  onChange={(e) => setForm({ ...form, surname: e.target.value })}
                />
              </div>
            )}
            <Field
              label={t("auth.email")}
              required
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Field
              label={t("auth.password")}
              required
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            {isSignup && (
              <Field
                label={t("auth.phone")}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            )}
            <button disabled={busy} type="submit" className="btn-primary-luxe w-full">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isDriver
                ? "Sign in as Driver"
                : isSignup
                  ? t("auth.create")
                  : t("cta.signin")}
            </button>
          </form>

          {!isSignup && !isDriver && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={busy}
                className="text-xs text-muted-foreground hover:text-gold underline-offset-4 hover:underline"
              >
                Forgot password?
              </button>
            </div>
          )}

          {isDriver && (
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              Sign-in attempts are recorded. Repeated failures may result in temporary account
              lockout. To apply as a driver, contact HarborLine dispatch directly — applications
              cannot be submitted through this app.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs transition " +
        (active
          ? "bg-gold-gradient text-primary-foreground shadow-luxe"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.9 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41 35.8 44 30.4 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}
