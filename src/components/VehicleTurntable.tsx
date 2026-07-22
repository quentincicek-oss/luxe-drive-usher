import { useEffect, useRef, useState } from "react";
import escaladeImg from "@/assets/car-escalade.png";

// Continuous, seamless 360-degree turntable for the hero vehicle.
//
// Responsive strategy (mobile parity with desktop):
//   The vehicle + platform + glow are authored ONCE at a fixed composition
//   size (COMP_W x COMP_H). On narrower viewports we scale the entire
//   composition uniformly using a CSS container query, so mobile sees the
//   exact same framing, angle, and internal proportions as desktop — just
//   smaller. No element is resized independently.

const COMP_W = 640; // authored composition width  (px)
const COMP_H = 460; // authored composition height (px)

export function VehicleTurntable({
  label,
  tagline,
}: {
  label: string;
  tagline: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [reduced, setReduced] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.src = escaladeImg;
    (img.decode ? img.decode() : Promise.resolve()).then(
      () => { if (!cancelled) setLoaded(true); },
      () => { if (!cancelled) setLoaded(true); },
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onVis = () => {
      el.style.animationPlayState = document.hidden ? "paused" : "running";
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loaded, reduced]);

  const animate = loaded && !reduced;

  // Scale factor derived from the card's own inline width via container queries.
  // At >= COMP_W we render 1:1 (desktop unchanged). Below that we scale down.
  const scaleExpr = `min(1, 100cqi / ${COMP_W})`;

  return (
    <div
      className="relative mx-auto max-w-4xl w-full overflow-hidden rounded-2xl border border-border/40 bg-surface-elevated shadow-luxe"
      style={{ containerType: "inline-size" }}
    >
      {/* Studio backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(212,175,55,0.14),transparent_65%)]" />
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/40 to-transparent dark:from-black/70" />
      </div>

      {/* Stage viewport — height tracks the uniformly scaled composition. */}
      <div
        className="relative w-full"
        style={{ height: `calc(${COMP_H}px * ${scaleExpr})` }}
      >
        {/* Fixed-size composition, uniformly scaled and centered. */}
        <div
          className="absolute left-1/2 top-0"
          style={{
            width: COMP_W,
            height: COMP_H,
            transform: `translateX(-50%) scale(${scaleExpr})`,
            transformOrigin: "top center",
          }}
        >
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Rotating platform under the vehicle */}
            <div
              ref={stageRef}
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                bottom: 56,
                width: 520,
                aspectRatio: "3 / 1",
                animation: animate ? "hl-turntable 22s linear infinite" : undefined,
                transformOrigin: "50% 50%",
                willChange: "transform",
              }}
              aria-hidden
            >
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    "conic-gradient(from 0deg, rgba(212,175,55,0.0) 0deg, rgba(212,175,55,0.7) 60deg, rgba(212,175,55,0.0) 120deg, rgba(212,175,55,0.0) 240deg, rgba(212,175,55,0.55) 300deg, rgba(212,175,55,0.0) 360deg)",
                  filter: "blur(8px)",
                  opacity: 0.85,
                }}
              />
              <div className="absolute inset-2 rounded-full border border-gold/40" />
              <div className="absolute inset-6 rounded-full border border-gold/20" />
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="absolute left-1/2 top-1/2 h-0.5 w-3 -translate-y-1/2 bg-gold/70"
                  style={{ transform: `translate(-50%,-50%) rotate(${(i * 360) / 24}deg) translateX(240px)` }}
                />
              ))}
            </div>

            {/* Vehicle */}
            <img
              src={escaladeImg}
              alt={label}
              width={1280}
              height={720}
              decoding="async"
              fetchPriority="high"
              draggable={false}
              onLoad={() => setLoaded(true)}
              className="relative z-10 h-auto drop-shadow-[0_40px_30px_rgba(0,0,0,0.55)]"
              style={{
                width: 560,
                transform: "translateY(-24px)",
                animation: animate ? "hl-vehicle-float 6s ease-in-out infinite" : undefined,
                opacity: loaded ? 1 : 0,
                transition: "opacity 400ms ease-out",
              }}
            />
          </div>
        </div>
      </div>

      <div className="relative z-10 border-t border-gold/20 bg-black/40 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] tracking-[0.35em] uppercase text-gold/80">{tagline}</div>
          <div className="font-display text-xl mt-0.5 text-foreground">{label}</div>
        </div>
      </div>

      <style>{`
        @keyframes hl-turntable {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes hl-vehicle-float {
          0%, 100% { transform: translateY(-24px); }
          50%      { transform: translateY(-32px); }
        }
      `}</style>
    </div>
  );
}
