import { useEffect, useRef, useState } from "react";
import { THEME, type Theme } from "@/theme/theme";

interface ThemeSelectorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

const OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: THEME.LIGHT, label: "Light" },
  { value: THEME.DARK, label: "Dark" },
  { value: THEME.SYSTEM, label: "System" },
];

function ThemeIcon({ theme }: { theme: Theme }): JSX.Element {
  if (theme === THEME.DARK) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.7 15.4A8.5 8.5 0 0 1 8.6 3.3 8.5 8.5 0 1 0 20.7 15.4Z" />
      </svg>
    );
  }

  if (theme === THEME.SYSTEM) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="13" rx="1.5" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function ThemeSelector({ value, onChange }: ThemeSelectorProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`theme-selector${open ? " theme-selector--open" : ""}`} ref={selectorRef}>
      <button
        type="button"
        className="theme-selector__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Theme: ${value}. Change theme`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Theme: ${value}`}
      >
        <ThemeIcon theme={value} />
        <svg className="theme-selector__chevron" viewBox="0 0 12 8" aria-hidden="true">
          <path d="m1 1 5 5 5-5" />
        </svg>
      </button>

      {open && (
        <div className="theme-selector__menu" role="menu" aria-label="Theme">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`theme-selector__option${value === option.value ? " theme-selector__option--active" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="menuitemradio"
              aria-checked={value === option.value}
            >
              <ThemeIcon theme={option.value} />
              <span>{option.label}</span>
              {value === option.value && (
                <svg className="theme-selector__check" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m3 8 3.2 3.2L13 4.8" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
