import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { HarborLogo } from "@/components/HarborLogo";
import { LanguageMenu } from "@/components/LanguageMenu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2, ShieldCheck, LogIn, Car, Phone } from "lucide-react";
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

type Mode = "passenger-signin" | "driver-signin" | "phone-signin";

// Generic error used by protected sign-in modes. Never reveals whether the
// email exists, is a passenger, an admin, or has no account at all.
const DRIVER_GENERIC_ERROR =
  "Driver access is available only to accounts provisioned by HarborLine. If you believe this is an error, contact your dispatcher.";

const ADMIN_WRONG_PORTAL =
  "Administrator accounts must sign in through the administrator portal.";

function Auth() {
  const nav = useNavigate();
  const { t } = useI18n();
  const { user, role, loading, roleLoading } = useAuth();
  const [mode, setMode] = useState<Mode>("passenger-signin");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  useEffect(() => {
    const titles: Record<Mode, string> = {
      "passenger-signin": t("cta.signin"),
      "driver-signin": t("auth.driver.title"),
      "phone-signin": t("cta.signin"),
    };
    document.title = `${titles[mode]} — ${t("brand.name")}`;
  }, [mode, t]);

  // Admin accounts must never be authenticated through the passenger portal.
  // Instead of silently signing out, we render a dedicated recovery panel
  // (see below) with clear paths to /admin or to switch accounts.
  // Passengers → /book, drivers → /driver.
  useEffect(() => {
    if (loading || roleLoading) return;
    if (!user) return;
    if (role === "driver") nav({ to: "/driver" });
    else if (role === "passenger") nav({ to: "/book" });
    // role === "admin" → handled below in the JSX.
  }, [user, role, loading, roleLoading, nav]);

  async function switchPassengerAccount() {
    setBusy(true);
    try {
      // Clear the current Supabase session and any stale local auth state so
      // the next OAuth round-trip starts from a clean slate.
      await supabase.auth.signOut({ scope: "global" }).catch(() => {});
      try {
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const k = window.localStorage.key(i);
          if (k && (k.startsWith("sb-") || k.startsWith("supabase."))) {
            window.localStorage.removeItem(k);
          }
        }
        window.sessionStorage.clear();
      } catch { /* storage may be unavailable */ }
      const { lovable } = await import("@/integrations/lovable/index");
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: { prompt: "select_account" },
      });
      if (result.error) throw new Error((result.error as Error).message || t("auth.googleFailed"));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("auth.googleFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function verifyDriverOrReject(_uid: string) {
    try {
      const { driverSignInEligibility } = await import("@/lib/mfa.functions");
      const res = await driverSignInEligibility({ data: {} });
      return res.ok === true;
    } catch {
      return false;
    }
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
    if (error) throw new Error(DRIVER_GENERIC_ERROR);
    const uid = data.user?.id;
    if (!uid) throw new Error(DRIVER_GENERIC_ERROR);
    const ok = await verifyDriverOrReject(uid);
    if (!ok) {
      await supabase.auth.signOut();
      throw new Error(DRIVER_GENERIC_ERROR);
    }
    toast.success(t("auth.welcome"));
  }

  async function handleForgotPassword() {
    const email = form.email.trim();
    if (!email) {
      toast.error(t("auth.forgot.enterEmail"));
      return;
    }
    setBusy(true);
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      /* never reveal existence */
    } finally {
      setBusy(false);
      toast.success(t("auth.forgot.sent"));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "passenger-signin") await handlePassengerSignIn();
      else await handleDriverSignIn();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("auth.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    // Passenger-only social sign-in. Force account selection so a stale
    // Google session (e.g. an administrator's Google account still signed in
    // at accounts.google.com) does not silently reauthenticate.
    setBusy(true);
    try {
      const { lovable } = await import("@/integrations/lovable/index");
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: { prompt: "select_account" },
      });
      if (result.error) throw new Error((result.error as Error).message || t("auth.googleFailed"));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("auth.googleFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function apple() {
    setBusy(true);
    try {
      const { lovable } = await import("@/integrations/lovable/index");
      const result = await lovable.auth.signInWithOAuth("apple", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw new Error((result.error as Error).message || "Apple sign-in unavailable.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Apple sign-in unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    const p = phone.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(p)) {
      toast.error("Enter a valid phone number in international format (e.g. +14155550123).");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: p });
      if (error) throw error;
      setOtpSent(true);
      toast.success("Verification code sent.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not send code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    const p = phone.trim();
    const code = otp.trim();
    if (!code) { toast.error("Enter the verification code."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: p, token: code, type: "sms" });
      if (error) throw error;
      toast.success(t("auth.welcome"));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Invalid code.");
    } finally {
      setBusy(false);
    }
  }

  const isDriver = mode === "driver-signin";
  const isPassenger = mode === "passenger-signin";
  const isPhone = mode === "phone-signin";
  const isAdminSession = !loading && !roleLoading && !!user && role === "admin";

  return (
    <main id="main-content" className="min-h-dvh bg-obsidian flex items-center justify-center px-4 py-8 sm:py-16">
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

        {isAdminSession ? (
          <div className="card-luxe p-6 sm:p-8" role="alert" aria-live="polite">
            <div className="flex items-start gap-3 mb-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
              <div>
                <h1 className="font-display text-xl mb-1">Administrator session detected</h1>
                <p className="text-sm text-muted-foreground">
                  {ADMIN_WRONG_PORTAL} You are currently signed in as{" "}
                  <span className="text-foreground">{user?.email ?? "an administrator"}</span>.
                </p>
              </div>
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => nav({ to: "/admin" })}
                className="btn-primary-luxe w-full"
              >
                Go to Administrator Portal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={switchPassengerAccount}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border/60 bg-background hover:border-gold py-3 text-sm font-medium disabled:opacity-60 min-h-11"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleGlyph />}
                Use a different passenger account
              </button>
            </div>
            <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground border-t border-border/40 pt-4">
              For security, administrator accounts cannot access passenger surfaces.
              Choosing a different passenger account signs out the current session
              and lets you pick another Google account.
            </p>
          </div>
        ) : (
        <>
        {/* Three sign-in entry points. No public self-registration. */}
        <div

          role="tablist"
          aria-label="Sign-in method"
          className="mb-5 grid grid-cols-3 gap-1 rounded-full border border-border/60 bg-surface/50 p-1 text-xs"
        >
          <TabBtn active={isPassenger} onClick={() => setMode("passenger-signin")} icon={<LogIn className="h-3.5 w-3.5" />}>
            {t("auth.tab.passenger")}
          </TabBtn>
          <TabBtn active={isPhone} onClick={() => setMode("phone-signin")} icon={<Phone className="h-3.5 w-3.5" />}>
            Phone
          </TabBtn>
          <TabBtn active={isDriver} onClick={() => setMode("driver-signin")} icon={<Car className="h-3.5 w-3.5" />}>
            {t("auth.tab.driver")}
          </TabBtn>
        </div>

        <div className="card-luxe p-6 sm:p-8">
          <h1 className="font-display text-2xl mb-1">
            {isDriver ? t("auth.driver.title") : t("cta.signin")}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            <span className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              <span>
                {isDriver ? t("auth.driver.notice") : t("auth.passenger.notice")}
              </span>
            </span>
          </p>

          {isPassenger && (
            <>
              <div className="grid gap-2">
                <button
                  onClick={google}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border/60 bg-background hover:border-gold py-3 text-sm font-medium disabled:opacity-60 min-h-11"
                >
                  <GoogleGlyph /> {t("cta.google")}
                </button>
                <button
                  onClick={apple}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border/60 bg-background hover:border-gold py-3 text-sm font-medium disabled:opacity-60 min-h-11"
                >
                  <AppleGlyph /> Continue with Apple
                </button>
              </div>
              <div className="my-5 flex items-center gap-3 text-[11px] tracking-widest text-muted-foreground uppercase">
                <div className="h-px flex-1 bg-border" />
                <span>{t("auth.or")}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          {isPhone ? (
            <div className="space-y-4">
              <Field
                label="Phone number"
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+14155550123"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              {otpSent && (
                <Field
                  label="Verification code"
                  required
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
              )}
              <button
                type="button"
                disabled={busy}
                onClick={otpSent ? verifyOtp : sendOtp}
                className="btn-primary-luxe w-full"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {otpSent ? "Verify code" : "Send code"}
              </button>
              {otpSent && (
                <button
                  type="button"
                  onClick={() => { setOtpSent(false); setOtp(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-gold"
                >
                  Use a different number
                </button>
              )}
            </div>
          ) : (
            <>
              <form onSubmit={submit} className="space-y-4" noValidate>
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
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <button disabled={busy} type="submit" className="btn-primary-luxe w-full">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isDriver ? t("auth.driver.submit") : t("cta.signin")}
                </button>
              </form>

              {isPassenger && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={busy}
                    className="text-xs text-muted-foreground hover:text-gold underline-offset-4 hover:underline"
                  >
                    {t("auth.forgot.link")}
                  </button>
                </div>
              )}
            </>
          )}

          <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground border-t border-border/40 pt-4">
            {t("auth.provisioning.notice")}
          </p>
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

function AppleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.42 2.23-1.24 3.07-.83.85-2.19 1.5-3.35 1.4-.13-1.11.41-2.24 1.19-3.03.85-.87 2.32-1.5 3.4-1.44zM20.5 17.42c-.57 1.32-.84 1.9-1.57 3.06-1.02 1.62-2.45 3.64-4.23 3.66-1.58.02-1.99-1.03-4.13-1.02-2.14.01-2.59 1.04-4.17 1.02-1.78-.02-3.13-1.84-4.15-3.46C-.63 16.53-.94 10.53 2.15 7.28c1.09-1.13 2.6-1.85 4.2-1.87 1.62-.03 3.15 1.09 4.13 1.09.97 0 2.83-1.35 4.78-1.15.81.03 3.09.33 4.55 2.47-3.9 2.14-3.28 7.79.69 9.6z"/>
    </svg>
  );
}
