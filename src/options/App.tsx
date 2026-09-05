import { ThemeSelector } from "@/popup/components/ThemeSelector";
import { useTheme } from "@/hooks/use-theme";

export function App(): JSX.Element {
  const [theme, setTheme] = useTheme();

  return (
    <main className="options">
      <h1>Switchboard Settings</h1>
      <section className="options__section">
        <div>
          <h2>Theme</h2>
          <p>Choose how Switchboard should look.</p>
        </div>
        <ThemeSelector value={theme} onChange={(next) => void setTheme(next)} />
      </section>
    </main>
  );
}
