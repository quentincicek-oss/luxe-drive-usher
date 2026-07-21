import { useEffect, useRef, useState } from "react";
import escaladeImg from "@/assets/car-escalade.png";

// Continuous, seamless 360-degree turntable for the hero vehicle.
// Implementation notes for reviewers:
//  - Uses a CSS @keyframes animation (0deg → 360deg). CSS keyframe animations
//    do NOT drift, do NOT restart on React re-renders, and loop seamlessly
//    because the first and last frames are the same transform.
//  - The image is preloaded before the animation starts to avoid frame drops
//    or a flash of an unloaded image.
//  - Respects prefers-reduced-motion: shows a static image instead.
//  - Pauses via animation-play-state when the tab is hidden, and resumes
//    without resetting the current rotation angle.

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

  // Preload the vehicle image; only start the animation once decoded.
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

  // Reduced motion watcher.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Pause animation when the tab is hidden. Toggling animation-play-state
  // preserves the current rotation angle — no snap back on resume.
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

  return (
    <div className="relative mx-auto max-w-4xl w-full overflow-hidden rounded-2xl border border-border/40 bg-surface-elevated shadow-luxe">
      {/* Studio backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(212,175,55,0.14),transparent_65%)]" />
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/40 to-transparent dark:from-black/70" />
      </div>

      <div className="relative h-[380px] sm:h-[460px] flex items-center justify-center">
        {/* Rotating platform under the vehicle. CSS keyframe = seamless loop. */}
        <div
          ref={stageRef}
          className="absolute left-1/2 bottom-14 -translate-x-1/2 w-[520px] max-w-[92%] aspect-[3/1]"
          style={{
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

        {/* Vehicle floats above turntable. Own animation (subtle bob),
            independent of the turntable so a theme swap can't reset it. */}
        <img
          src={escaladeImg}
          alt={label}
          width={1280}
          height={720}
          decoding="async"
          fetchPriority="high"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className="relative z-10 w-[560px] max-w-[80vw] h-auto drop-shadow-[0_40px_30px_rgba(0,0,0,0.55)] -translate-y-6"
          style={{
            animation: animate ? "hl-vehicle-float 6s ease-in-out infinite" : undefined,
            opacity: loaded ? 1 : 0,
            transition: "opacity 400ms ease-out",
          }}
        />
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
