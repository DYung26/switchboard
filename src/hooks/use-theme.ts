import { useCallback, useEffect, useState } from "react";
import { storageService } from "@/storage";
import {
  applyTheme,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  type Theme,
} from "@/theme/theme";

export function useTheme(): readonly [Theme, (theme: Theme) => Promise<void>] {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    let isMounted = true;

    void storageService.get<Theme>(THEME_STORAGE_KEY).then((stored) => {
      if (isMounted) {
        const next = stored ?? DEFAULT_THEME;
        setThemeState(next);
        applyTheme(next);
      }
    });

    const unwatch = storageService.watch<Theme>(
      THEME_STORAGE_KEY,
      (change) => {
        if (isMounted) {
          const next = change.newValue ?? DEFAULT_THEME;
          setThemeState(next);
          applyTheme(next);
        }
      },
    );

    return () => {
      isMounted = false;
      unwatch();
    };
  }, []);

  const setTheme = useCallback(async (next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    await storageService.set(THEME_STORAGE_KEY, next);
  }, []);

  return [theme, setTheme] as const;
}
