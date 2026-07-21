import { useEffect, useRef, useState } from "react";
import escaladeImg from "@/assets/car-escalade.png";

// Static vehicle fallback with a persistent ambient platform animation.
// The project only has single flat PNG vehicle assets, not a 360° frame
// sequence or a 3D model. Rotating the PNG around the Z axis looked like a
// fake turntable and exposed a loop boundary, so the vehicle itself now stays
// static. The platform light is advanced with requestAnimationFrame using
// elapsed delta time and a persistent accumulator; it never restarts from a
// CSS keyframe cycle and does not update React state per frame.

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
  const angleRef = useRef(0);

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

  // Ambient platform light animation. This is intentionally not a vehicle
  // turntable: with only one PNG, true vehicle rotation is not possible.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !loaded || reduced || typeof window === "undefined") return;

    let frameId = 0;
    let last = performance.now();
    const angularVelocity = 14; // degrees per second, subtle studio sweep

    const tick = (now: number) => {
      const deltaSeconds = Math.min((now - last) / 1000, 0.1);
      last = now;

      if (!document.hidden) {
        angleRef.current += angularVelocity * deltaSeconds;
        el.style.setProperty("--platform-angle", `${angleRef.current}deg`);
      }

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [loaded, reduced]);

  const animatePlatform = loaded && !reduced;

  return (
    <div className="relative mx-auto max-w-4xl w-full overflow-hidden rounded-2xl border border-border/40 bg-surface-elevated shadow-luxe">
      {/* Studio backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(212,175,55,0.14),transparent_65%)]" />
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/40 to-transparent dark:from-black/70" />
      </div>

      <div className="relative h-[380px] sm:h-[460px] flex items-center justify-center">
        {/* Ambient platform under the static vehicle. */}
        <div
          ref={stageRef}
          className="absolute left-1/2 bottom-14 -translate-x-1/2 w-[520px] max-w-[92%] aspect-[3/1]"
          style={{
            transformOrigin: "50% 50%",
            willChange: animatePlatform ? "contents" : undefined,
            ["--platform-angle" as string]: `${angleRef.current}deg`,
          }}
          aria-hidden
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from var(--platform-angle, 0deg), rgba(212,175,55,0.0) 0deg, rgba(212,175,55,0.7) 60deg, rgba(212,175,55,0.0) 120deg, rgba(212,175,55,0.0) 240deg, rgba(212,175,55,0.55) 300deg, rgba(212,175,55,0.0) 360deg)",
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

        {/* Static vehicle: true 360° requires a frame sequence or 3D model. */}
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
    </div>
  );
}
