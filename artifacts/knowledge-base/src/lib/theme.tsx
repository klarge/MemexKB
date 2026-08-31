import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "memex-theme";

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  return [
    parseInt(match[1].slice(0, 2), 16),
    parseInt(match[1].slice(2, 4), 16),
    parseInt(match[1].slice(4, 6), 16),
  ];
}

function rgbToHsl([red, green, blue]: [number, number, number]): string {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    switch (max) {
      case r:
        hue = ((g - b) / delta) % 6;
        break;
      case g:
        hue = (b - r) / delta + 2;
        break;
      default:
        hue = (r - g) / delta + 4;
    }
    hue /= 6;
    if (hue < 0) hue += 1;
  }

  return `${Math.round(hue * 360)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

function getReadableForeground([r, g, b]: [number, number, number]): string {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.179 ? "0 0% 8%" : "0 0% 100%";
}

/**
 * Applies the saved brand color to the shared primary tokens. Inline root
 * variables intentionally override the light/dark defaults while preserving
 * the mode-specific surfaces around them.
 */
export function applyAccentColor(accentColor: string | null | undefined): void {
  const root = document.documentElement;
  const rgb = accentColor ? hexToRgb(accentColor) : null;
  const properties = [
    "--primary",
    "--primary-foreground",
    "--sidebar-primary",
    "--sidebar-primary-foreground",
    "--sidebar-ring",
    "--ring",
    "--chart-1",
  ];

  if (!rgb) {
    properties.forEach((property) => root.style.removeProperty(property));
    return;
  }

  const color = rgbToHsl(rgb);
  const foreground = getReadableForeground(rgb);
  root.style.setProperty("--primary", color);
  root.style.setProperty("--primary-foreground", foreground);
  root.style.setProperty("--sidebar-primary", color);
  root.style.setProperty("--sidebar-primary-foreground", foreground);
  root.style.setProperty("--sidebar-ring", color);
  root.style.setProperty("--ring", color);
  root.style.setProperty("--chart-1", color);
}

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
    }
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
