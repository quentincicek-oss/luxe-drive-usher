import { useEffect, useRef, useState } from "react";
import escaladeImg from "@/assets/car-escalade.png";
import suburbanImg from "@/assets/car-suburban.png";
import denaliImg from "@/assets/car-denali.png";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type RideType = "escalade" | "suburban" | "denali";

type Vehicle = {
  id: RideType;
  name: string;
  tagline: string;
  seats: number;
  rate: string;
  img: string;
};

const VEHICLES: Vehicle[] = [
  { id: "escalade", name: "Cadillac Escalade", tagline: "Flagship luxury", seats: 6, rate: "$4.50/mi", img: escaladeImg },
  { id: "suburban", name: "Chevrolet Suburban", tagline: "Discreet & spacious", seats: 7, rate: "$4.20/mi", img: suburbanImg },
  { id: "denali",   name: "GMC Yukon Denali",  tagline: "Refined performance", seats: 6, rate: "$4.80/mi", img: denaliImg },
];

type Props = {
  value: RideType;
  onChange: (v: RideType) => void;
};

export function VehicleShowroom({ value, onChange }: Props) {
  const idx = Math.max(0, VEHICLES.findIndex((v) => v.id === value));
  const [dragX, setDragX] = useState(0);
  const startX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const go = (dir: -1 | 1) => {
    const next = (idx + dir + VEHICLES.length) % VEHICLES.length;
    onChange(VEHICLES[next].id);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current === null) return;
    setDragX(e.clientX - startX.current);
  };
  const onPointerUp = () => {
    if (startX.current === null) return;
    const dx = dragX;
    startX.current = null;
    setDragX(0);
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    const el = containerRef.current;
    el?.addEventListener("keydown", onKey as EventListener);
    return () => el?.removeEventListener("keydown", onKey as EventListener);
  });

  const current = VEHICLES[idx];

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="relative select-none rounded-2xl border border-border/60 bg-gradient-to-b from-black via-obsidian to-black overflow-hidden outline-none focus:ring-1 focus:ring-gold/40"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ perspective: "1400px" }}
    >
      {/* Studio backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(212,175,55,0.10),transparent_60%)]" />
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/80 to-transparent" />
        {/* grid floor */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(transparent, rgba(212,175,55,0.15) 60%, rgba(212,175,55,0.35)), repeating-linear-gradient(90deg, rgba(212,175,55,0.15) 0 1px, transparent 1px 60px), repeating-linear-gradient(0deg, rgba(212,175,55,0.10) 0 1px, transparent 1px 60px)",
            transform: "perspective(600px) rotateX(60deg)",
            transformOrigin: "bottom",
          }}
        />
      </div>

      {/* Stage */}
      <div className="relative h-[420px] sm:h-[460px]">
        {/* Turntable */}
        <div className="absolute left-1/2 bottom-16 -translate-x-1/2 w-[520px] max-w-[92%] aspect-[3/1]">
          {/* rotating ring */}
          <div className="absolute inset-0 rounded-full animate-[spin_18s_linear_infinite]"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(212,175,55,0.6) 20deg, transparent 40deg, transparent 180deg, rgba(212,175,55,0.5) 200deg, transparent 220deg, transparent 360deg)",
              filter: "blur(6px)",
              opacity: 0.7,
            }}
          />
          <div className="absolute inset-2 rounded-full border border-gold/40" />
          <div className="absolute inset-6 rounded-full border border-gold/20" />
          <div className="absolute inset-0 rounded-full shadow-[0_0_60px_10px_rgba(212,175,55,0.25)_inset]" />
          {/* LED ticks */}
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="absolute left-1/2 top-1/2 h-0.5 w-3 -translate-y-1/2 bg-gold/70"
              style={{ transform: `translate(-50%,-50%) rotate(${(i * 360) / 24}deg) translateX(240px)` }}
            />
          ))}
        </div>

        {/* Cars carousel */}
        <div className="absolute inset-0 flex items-center justify-center">
          {VEHICLES.map((v, i) => {
            const offset = i - idx;
            const active = offset === 0;
            const translate = offset * 62 + (active ? dragX * 0.4 : 0);
            const scale = active ? 1 : 0.6;
            const rotY = offset * -18;
            const opacity = Math.abs(offset) > 1 ? 0 : active ? 1 : 0.35;
            const z = active ? 20 : 10 - Math.abs(offset);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onChange(v.id)}
                aria-label={v.name}
                className="absolute transition-all duration-500 ease-out will-change-transform"
                style={{
                  transform: `translateX(${translate}%) translateY(-32px) scale(${scale}) rotateY(${rotY}deg)`,
                  opacity,
                  zIndex: z,
                  transformStyle: "preserve-3d",
                }}
              >
                <img
                  src={v.img}
                  alt={v.name}
                  width={1280}
                  height={720}
                  draggable={false}
                  className="w-[560px] max-w-[80vw] h-auto drop-shadow-[0_40px_30px_rgba(0,0,0,0.7)]"
                  style={{
                    animation: active ? "showroom-float 6s ease-in-out infinite" : undefined,
                  }}
                />
              </button>
            );
          })}
        </div>

        {/* Nav arrows */}
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous vehicle"
          className="absolute left-3 top-1/2 -translate-y-1/2 z-30 h-11 w-11 rounded-full border border-gold/40 bg-black/50 backdrop-blur flex items-center justify-center hover:bg-gold/20 transition"
        >
          <ChevronLeft className="h-5 w-5 text-gold" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next vehicle"
          className="absolute right-3 top-1/2 -translate-y-1/2 z-30 h-11 w-11 rounded-full border border-gold/40 bg-black/50 backdrop-blur flex items-center justify-center hover:bg-gold/20 transition"
        >
          <ChevronRight className="h-5 w-5 text-gold" />
        </button>
      </div>

      {/* Info bar */}
      <div className="relative z-10 border-t border-gold/20 bg-black/60 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] tracking-[0.35em] uppercase text-gold/80">{current.tagline}</div>
          <div className="font-display text-xl mt-0.5">{current.name}</div>
        </div>
      </div>

      {/* Dots */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-2 z-30">
        {VEHICLES.map((v, i) => (
          <button
            key={v.id}
            type="button"
            aria-label={v.name}
            onClick={() => onChange(v.id)}
            className={"h-1.5 rounded-full transition-all " + (i === idx ? "w-8 bg-gold" : "w-1.5 bg-gold/30")}
          />
        ))}
      </div>

      <style>{`
        @keyframes showroom-float {
          0%,100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
