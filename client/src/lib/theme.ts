export type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "vw_theme_mode";

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "dark" || value === "system" ? value : "light";
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  const isDark = mode === "dark" || (mode === "system" && prefersDark);
  root.classList.toggle("dark", isDark);
  root.dataset.themeMode = mode;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore storage unavailability in restricted contexts.
  }
}

export function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    return normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}
