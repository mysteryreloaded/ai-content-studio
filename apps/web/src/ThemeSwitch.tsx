import { THEME_MODES, THEME_MODE_LABELS } from "./theme.js";
import { useTheme } from "./useTheme.js";

/** System / Light / Dark, shown in every footer (issue #65). */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  return (
    <fieldset>
      <legend>Theme</legend>
      {THEME_MODES.map((mode) => (
        <label key={mode}>
          <input
            type="radio"
            name="theme"
            value={mode}
            checked={theme === mode}
            onChange={() => setTheme(mode)}
          />
          {THEME_MODE_LABELS[mode]}
        </label>
      ))}
    </fieldset>
  );
}
