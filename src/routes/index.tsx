import { createFileRoute, Link } from "@tanstack/react-router";
import { HarborLogo, Wordmark } from "@/components/HarborLogo";
import { LanguageMenu } from "@/components/LanguageMenu";
import { VehicleTurntable } from "@/components/VehicleTurntable";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useEffect, useRef } from "react";
import introVideo from "@/assets/intro-hero.mp4.asset.json";
import { Award, CalendarCheck, ShieldCheck, Sparkles, Globe2, ChevronRight, Phone, Mail, MapPin } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HarborLine Executive Services — VIP Concierge Rides Across the US" },
      { name: "description", content: "Chauffeured Cadillac Escalade, Suburban, and Denali. Executive travel, refined. Reserve in seconds." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t } = useI18n();
  const { user, role } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { videoRef.current?.play().catch(() => {}); }, []);
  useEffect(() => { document.title = `${t("brand.name")} ${t("brand.services")}`; }, [t]);

  const features = [
    { icon: Award, label: t("landing.features.drivers") },
    { icon: CalendarCheck, label: t("landing.features.booking") },
    { icon: ShieldCheck, label: t("landing.features.reliable") },
    { icon: Sparkles, label: t("landing.features.luxury") },
    { icon: Globe2, label: t("landing.features.global") },
  ];

  const fleet = [
    { name: "Cadillac Escalade", tag: t("fleet.escalade.tag"), pax: "1–6" },
    { name: "Chevrolet Suburban", tag: t("fleet.suburban.tag"), pax: "1–7" },
    { name: "GMC Denali", tag: t("fleet.denali.tag"), pax: "1–6" },
  ];

  return (
    <main id="main-content" className="relative min-h-dvh bg-obsidian">
      {/* HERO — cinematic video */}
      <section className="relative min-h-dvh w-full overflow-hidden">

        <video
          ref={videoRef}
          src={introVideo.url}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Feathered edges — 4 diagonal corner gradients + heavy vignette */}
        <div className="absolute inset-0 vignette" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/70 via-background/10 to-background" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background/50 via-transparent to-background/50" />

        {/* Top bar */}
        <header className="relative z-10 flex items-center justify-between px-6 md:px-12 pt-8">
          <div className="flex items-center gap-3">
            <HarborLogo className="h-10 w-10" />
            <div className="hidden md:block">
              <div className="font-display text-lg text-gradient-gold leading-none">HarborLine</div>
              <div className="text-[9px] tracking-[0.35em] text-muted-foreground mt-1 uppercase">{t("brand.services")}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageMenu />
            {user ? (
              <Link to={role === "admin" ? "/admin" : "/book"} className="rounded-full bg-gold-gradient px-5 py-2 text-xs font-semibold tracking-wide text-primary-foreground shadow-gold">
                {t("cta.continue")}
              </Link>
            ) : (
              <Link to="/auth" className="rounded-full bg-gold-gradient px-5 py-2 text-xs font-semibold tracking-wide text-primary-foreground shadow-gold">
                {t("cta.signin")}
              </Link>
            )}
          </div>
        </header>

        {/* Hero content — single flex column, responsive clamp gaps, no overlap */}
        <div
          className="relative z-10 flex flex-col items-center justify-start text-center px-6 pb-10"
          style={{
            paddingTop: "clamp(3rem, 12vh, 8rem)",
            gap: "clamp(1rem, 2.5vh, 2rem)",
          }}
        >
          <div className="animate-scale-in">
            <HarborLogo className="h-20 w-20 sm:h-24 sm:w-24 md:h-28 md:w-28" />
          </div>
          <div className="animate-fade-up" style={{ animationDelay: "0.4s" }}>
            <Wordmark subtitle={t("brand.services")} />
          </div>
          <h1
            className="max-w-3xl font-display leading-[1.1] animate-fade-up"
            style={{ animationDelay: "0.8s", fontSize: "clamp(1.9rem, 5.5vw, 4.5rem)" }}
          >
            <span className="text-foreground">{t("landing.hero.title1")} </span>
            <span className="text-gradient-gold italic">{t("landing.hero.title2")}</span>
          </h1>
          <div
            className="text-gold/90 font-medium animate-fade-in"
            style={{
              animationDelay: "1.0s",
              fontSize: "clamp(0.7rem, 1.1vw, 0.9rem)",
              letterSpacing: "0.45em",
            }}
          >
            {t("brand.tagline")}
          </div>
          <p
            className="max-w-xl text-muted-foreground animate-fade-up"
            style={{ animationDelay: "1.1s", fontSize: "clamp(0.85rem, 1.1vw, 1rem)" }}
          >
            {t("landing.hero.body")}
          </p>
          <div
            className="flex flex-wrap items-center justify-center gap-3 animate-fade-up"
            style={{ animationDelay: "1.4s", marginTop: "clamp(0.5rem, 1.5vh, 1.25rem)" }}
          >
            <Link to={user ? "/book" : "/auth"} className="group inline-flex items-center gap-2 rounded-full bg-gold-gradient px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow-gold hover:brightness-110 transition">
              {t("cta.book")}
              <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            {!user && (
              <Link to="/auth" className="rounded-full border border-border/70 bg-background/40 backdrop-blur px-6 py-3.5 text-sm hover:border-gold">
                {t("cta.signup")}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="relative py-24 px-6 md:px-12 border-t border-border/40">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            {features.map((f) => (
              <div key={f.label} className="group flex flex-col items-center text-center gap-3 p-6 rounded-lg border border-border/40 bg-surface hover:border-gold/50 transition">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-gradient shadow-gold">
                  <f.icon className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="text-xs md:text-sm font-medium tracking-wide">{f.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FLEET */}
      <section className="relative py-24 px-6 md:px-12 border-t border-border/40">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-14">
            <div className="text-xs tracking-[0.4em] text-gold uppercase mb-3">{t("landing.fleet.eyebrow")}</div>
            <h2 className="font-display text-4xl md:text-5xl">{t("landing.fleet.title")}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{t("landing.fleet.body")}</p>
          </div>
          <div className="mb-14">
            <VehicleTurntable label="Cadillac Escalade" tagline={t("fleet.escalade.tag")} />
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {fleet.map((v) => (
              <div key={v.name} className="group relative overflow-hidden rounded-lg border border-border/40 bg-surface-elevated shadow-luxe p-8 hover:border-gold/60 transition">
                <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-gold-gradient opacity-10 blur-3xl group-hover:opacity-20 transition" />
                <div className="text-xs tracking-widest text-gold uppercase">{v.tag}</div>
                <div className="mt-3 font-display text-2xl">{v.name}</div>
                <div className="mt-6 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("landing.fleet.passengers")}</span>
                  <span className="font-medium">{v.pax}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("landing.fleet.class")}</span>
                  <span className="font-medium">{t("landing.fleet.class.value")}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section className="relative py-20 px-6 md:px-12 border-t border-border/40">
        <div className="mx-auto max-w-5xl grid md:grid-cols-3 gap-6">
          <div className="flex items-start gap-3">
            <Phone className="h-5 w-5 text-gold mt-1" />
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{t("contact.247")}</div>
              <div className="mt-1 font-medium">+1 (888) 555-HARB</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-gold mt-1" />
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{t("contact.reservations")}</div>
              <div className="mt-1 font-medium">concierge@harborline.us</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="h-5 w-5 text-gold mt-1" />
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{t("contact.region")}</div>
              <div className="mt-1 font-medium">{t("contact.region.value")}</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/40 py-10 px-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} HarborLine {t("brand.services")}. {t("footer.rights")}
      </footer>
    </main>
  );
}
