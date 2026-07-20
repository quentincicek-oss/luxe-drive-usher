import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Auto day/night theme.
// - "auto" uses the device's local IANA timezone (via Date) — daylight-saving aware.
// - Day: 07:00 through 18:59 local time. Night: 19:00 through 06:59 local time.
// - Manual override "day" or "night" stays fixed until user returns to "auto".

export type Theme = "day" | "night";
export type Mode = "auto" | "day" | "night";

const STORAGE_KEY = "hl_theme_mode";
const DAY_START = 7;   // inclusive
const DAY_END = 19;    // exclusive; 19:00 is night

interface Ctx {
  theme: Theme;      // resolved theme currently applied
  mode: Mode;        // user preference
  setMode: (m: Mode) => void;
}
const ThemeCtx = createContext<Ctx | null>(null);

function computeAuto(now = new Date()): Theme {
  const h = now.getHours();
  return h >= DAY_START && h < DAY_END ? "day" : "night";
}

function readStoredMode(): Mode {
  if (typeof window === "undefined") return "auto";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "day" || v === "night" || v === "auto") return v;
  } catch { /* ignore */ }
  return "auto";
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  // Reflect on both html (for CSS variable swap) and data attribute for scoped selectors.
  root.classList.remove("light", "dark", "day", "night");
  root.classList.add(t === "day" ? "light" : "dark");
  root.classList.add(t);
  root.dataset.theme = t;
  root.style.colorScheme = t === "day" ? "light" : "dark";
}

function msUntilNextBoundary(now = new Date()): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  const h = now.getHours();
  // Next boundary is either DAY_START or DAY_END, whichever comes next.
  const isDay = h >= DAY_START && h < DAY_END;
  const targetHour = isDay ? DAY_END : DAY_START;
  if (targetHour <= h) next.setDate(next.getDate() + 1);
  next.setHours(targetHour);
  return Math.max(1000, next.getTime() - now.getTime());
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => readStoredMode());
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window === "undefined" ? "night" : (readStoredMode() === "auto" ? computeAuto() : (readStoredMode() as Theme)),
  );

  const setMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* ignore */ }
  };

  useEffect(() => {
    let boundaryTimer: number | null = null;
    let tzInterval: number | null = null;
    let lastTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const resolve = (): Theme =>
      mode === "auto" ? computeAuto() : (mode as Theme);

    const tick = () => {
      const next = resolve();
      setTheme((prev) => {
        if (prev !== next) applyTheme(next);
        return next;
      });
      if (mode === "auto") {
        if (boundaryTimer) window.clearTimeout(boundaryTimer);
        boundaryTimer = window.setTimeout(tick, msUntilNextBoundary());
      }
    };

    // Apply immediately (handles user changing mode).
    applyTheme(resolve());
    setTheme(resolve());
    if (mode === "auto") {
      boundaryTimer = window.setTimeout(tick, msUntilNextBoundary());
    }

    const onVisibility = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVisibility);

    // Detect device timezone changes (rare but supported: user travels / OS changes tz).
    tzInterval = window.setInterval(() => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz !== lastTz) { lastTz = tz; tick(); }
    }, 60_000);

    return () => {
      if (boundaryTimer) window.clearTimeout(boundaryTimer);
      if (tzInterval) window.clearInterval(tzInterval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode]);

  return <ThemeCtx.Provider value={{ theme, mode, setMode }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useTheme must be inside ThemeProvider");
  return c;
}

// Inline script that runs before hydration to eliminate flash of wrong theme.
// Injected via dangerouslySetInnerHTML in the root shell head.
export const themeBootstrapScript = `
(function(){
  try {
    var m = localStorage.getItem('${STORAGE_KEY}');
    var t;
    if (m === 'day' || m === 'night') { t = m; }
    else {
      var h = new Date().getHours();
      t = (h >= ${DAY_START} && h < ${DAY_END}) ? 'day' : 'night';
    }
    var r = document.documentElement;
    r.classList.add(t === 'day' ? 'light' : 'dark');
    r.classList.add(t);
    r.setAttribute('data-theme', t);
    r.style.colorScheme = t === 'day' ? 'light' : 'dark';
  } catch(e){}
})();
`.trim();
