export const THEME_STORAGE_KEY = "settings:theme";

export const THEME = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark",
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

export const DEFAULT_THEME: Theme = THEME.SYSTEM;

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  if (theme === THEME.SYSTEM) {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}
