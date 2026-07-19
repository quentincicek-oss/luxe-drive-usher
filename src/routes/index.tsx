import { createFileRoute, Link } from "@tanstack/react-router";
import { HarborLogo, Wordmark } from "@/components/HarborLogo";
import { useI18n, SUPPORTED } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useEffect, useRef, useState } from "react";
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
  const { t, lang, setLang } = useI18n();
  const { user, role } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [langOpen, setLangOpen] = useState(false);

  useEffect(() => { videoRef.current?.play().catch(() => {}); }, []);

  const features = [
    { icon: Award, label: t("landing.features.drivers") },
    { icon: CalendarCheck, label: t("landing.features.booking") },
    { icon: ShieldCheck, label: t("landing.features.reliable") },
    { icon: Sparkles, label: t("landing.features.luxury") },
    { icon: Globe2, label: t("landing.features.global") },
  ];

  const fleet = [
    { name: "Cadillac Escalade", tag: "Flagship Executive SUV", pax: "1–6" },
    { name: "Chevrolet Suburban", tag: "Group & Executive Travel", pax: "1–7" },
    { name: "GMC Denali", tag: "Premium Business Class", pax: "1–6" },
  ];

  return (
    <main className="relative min-h-screen bg-obsidian">
      {/* HERO — cinematic video */}
      <section className="relative h-[100vh] w-full overflow-hidden">
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
              <div className="text-[9px] tracking-[0.35em] text-muted-foreground mt-1">EXECUTIVE SERVICES</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setLangOpen((x) => !x)}
                className="rounded-full border border-border/70 bg-background/50 backdrop-blur px-4 py-2 text-xs uppercase tracking-widest hover:border-gold transition"
              >{SUPPORTED.find((s) => s.code === lang)?.label ?? "EN"}</button>
              {langOpen && (
                <div className="absolute right-0 mt-2 w-44 rounded-md border border-border bg-popover shadow-luxe p-1 z-50">
                  {SUPPORTED.map((s) => (
                    <button
                      key={s.code}
                      onClick={() => { setLang(s.code as typeof lang); setLangOpen(false); }}
                      className={"block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent " + (s.code === lang ? "text-gold" : "")}
                    >{s.label}</button>
                  ))}
                </div>
              )}
            </div>
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

        {/* Hero content */}
        <div className="relative z-10 flex flex-col items-center justify-center px-6 text-center mt-[18vh] md:mt-[22vh]">
          <div className="animate-scale-in">
            <HarborLogo className="h-24 w-24 md:h-28 md:w-28" />
          </div>
          <div className="mt-4 animate-fade-up" style={{ animationDelay: "0.4s" }}>
            <Wordmark />
          </div>
          <h1
            className="mt-10 max-w-3xl font-display text-4xl md:text-6xl lg:text-7xl leading-[1.05] animate-fade-up"
            style={{ animationDelay: "0.8s" }}
          >
            <span className="text-foreground">Executive travel, </span>
            <span className="text-gradient-gold italic">refined.</span>
          </h1>
          <p
            className="mt-6 max-w-xl text-sm md:text-base text-muted-foreground animate-fade-up"
            style={{ animationDelay: "1.1s" }}
          >
            {t("landing.hero.body")}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 animate-fade-up" style={{ animationDelay: "1.4s" }}>
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
          {/* Fleet labels */}
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[10px] md:text-xs tracking-[0.35em] text-muted-foreground/80 animate-fade-in" style={{ animationDelay: "2s" }}>
            <span>CADILLAC ESCALADE</span>
            <span className="text-gold">◆</span>
            <span>CHEVROLET SUBURBAN</span>
            <span className="text-gold">◆</span>
            <span>GMC DENALI</span>
          </div>
        </div>

        {/* Tagline */}
        <div className="absolute bottom-6 inset-x-0 z-10 text-center animate-fade-in" style={{ animationDelay: "2.5s" }}>
          <div className="text-[11px] md:text-sm tracking-[0.55em] text-gold/90 font-medium">
            {t("brand.tagline")}
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
            <div className="text-xs tracking-[0.4em] text-gold uppercase mb-3">The Fleet</div>
            <h2 className="font-display text-4xl md:text-5xl">Three signature vehicles.</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">Every ride is fully insured, tracked in real time, and helmed by a vetted chauffeur.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {fleet.map((v) => (
              <div key={v.name} className="group relative overflow-hidden rounded-lg border border-border/40 bg-surface-elevated shadow-luxe p-8 hover:border-gold/60 transition">
                <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-gold-gradient opacity-10 blur-3xl group-hover:opacity-20 transition" />
                <div className="text-xs tracking-widest text-gold uppercase">{v.tag}</div>
                <div className="mt-3 font-display text-2xl">{v.name}</div>
                <div className="mt-6 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Passengers</span>
                  <span className="font-medium">{v.pax}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Class</span>
                  <span className="font-medium">Executive</span>
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
              <div className="text-xs uppercase tracking-widest text-muted-foreground">24/7 Concierge</div>
              <div className="mt-1 font-medium">+1 (888) 555-HARB</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-gold mt-1" />
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Reservations</div>
              <div className="mt-1 font-medium">concierge@harborline.us</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="h-5 w-5 text-gold mt-1" />
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Service Region</div>
              <div className="mt-1 font-medium">United States — Nationwide</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/40 py-10 px-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} HarborLine Executive Services. All rights reserved.
      </footer>
    </main>
  );
}
