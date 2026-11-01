import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group.js";
import { THEME_MODES, THEME_MODE_LABELS, type ThemeMode } from "./theme.js";
import { useTheme } from "./useTheme.js";

/** System / Light / Dark as a shadcn ToggleGroup, shown in every footer (issue #65, restyled #173). */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      type="single"
      size="sm"
      aria-label="Theme"
      value={theme}
      onValueChange={(value) => {
        // `type="single"` without `required` clears the value when the
        // already-selected mode is clicked again; treat that as "no change"
        // rather than a switch to a blank theme.
        if (value) setTheme(value as ThemeMode);
      }}
    >
      {THEME_MODES.map((mode) => (
        <ToggleGroupItem key={mode} value={mode}>
          {THEME_MODE_LABELS[mode]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
