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
  // If an admin session ends up here (e.g. via cross-tab session), sign them
  // out immediately and hold them on /auth. Passengers → /book, drivers → /driver.
  useEffect(() => {
    if (loading || roleLoading) return;
    if (!user) return;
    if (role === "admin") {
      void (async () => {
        await supabase.auth.signOut();
        toast.error(ADMIN_WRONG_PORTAL);
      })();
      return;
    }
    if (role === "driver") nav({ to: "/driver" });
    else if (role === "passenger") nav({ to: "/book" });
  }, [user, role, loading, roleLoading, nav]);

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
    // Passenger-only social sign-in.
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
