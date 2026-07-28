/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "midsam-theme";

type ThemeContextValue = {
  /** O que o usuário escolheu, incluindo "system". */
  theme: Theme;
  /** O que está de fato pintado na tela — "system" já resolvido. */
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): Theme {
  if (typeof localStorage === "undefined") return "system";
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function prefersDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: Theme): "light" | "dark" {
  const resolved = theme === "system" ? (prefersDark() ? "dark" : "light") : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    theme === "system" ? (prefersDark() ? "dark" : "light") : theme,
  );

  useEffect(() => {
    setResolved(applyTheme(theme));
  }, [theme]);

  // Em "system", acompanha a mudança do tema do SO sem precisar recarregar.
  useEffect(() => {
    if (theme !== "system" || typeof matchMedia === "undefined") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(applyTheme("system"));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const currentlyDark =
        current === "dark" || (current === "system" && prefersDark());
      const next: Theme = currentlyDark ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme precisa estar dentro de <ThemeProvider>");
  return context;
}
