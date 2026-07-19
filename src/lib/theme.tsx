import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
type Mode = "auto" | "force-light" | "force-dark";

interface Ctx {
  theme: Theme;
  mode: Mode;
  setMode: (m: Mode) => void;
}
const ThemeCtx = createContext<Ctx | null>(null);

function computeAuto(): Theme {
  if (typeof window === "undefined") return "dark";
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("auto");
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = localStorage.getItem("hl_theme_mode") as Mode | null;
    if (stored) setMode(stored);
  }, []);

  useEffect(() => {
    localStorage.setItem("hl_theme_mode", mode);
    const apply = () => {
      const t: Theme = mode === "auto" ? computeAuto() : mode === "force-light" ? "light" : "dark";
      setTheme(t);
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(t);
    };
    apply();
    if (mode === "auto") {
      const id = setInterval(apply, 60_000);
      return () => clearInterval(id);
    }
  }, [mode]);

  return <ThemeCtx.Provider value={{ theme, mode, setMode }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useTheme must be inside ThemeProvider");
  return c;
}
