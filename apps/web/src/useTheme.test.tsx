import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render, fireEvent, within } = await import(
  "@testing-library/react"
);
const { useTheme } = await import("./useTheme.js");
const { THEME_STORAGE_KEY } = await import("./theme.js");

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

/** Exercises `useTheme()` through plain buttons, since this repo has no `renderHook` helper. */
function ThemeProbe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <output>
        {theme}/{resolvedTheme}
      </output>
      <button type="button" onClick={() => setTheme("light")}>
        light
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        dark
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        system
      </button>
    </div>
  );
}

describe("useTheme", () => {
  test("defaults to system with no data-theme attribute set", () => {
    const view = render(<ThemeProbe />);
    expect(view.getByRole("status").textContent).toStartWith("system/");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  test("setTheme('dark') stores the choice and sets data-theme on <html>", () => {
    const view = render(<ThemeProbe />);
    fireEvent.click(view.getByRole("button", { name: "dark" }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(view.getByRole("status").textContent).toBe("dark/dark");
  });

  test("setTheme('light') stores the choice and sets data-theme on <html>", () => {
    const view = render(<ThemeProbe />);
    fireEvent.click(view.getByRole("button", { name: "light" }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(view.getByRole("status").textContent).toBe("light/light");
  });

  test("setTheme('system') after a choice clears the data-theme attribute", () => {
    const view = render(<ThemeProbe />);
    fireEvent.click(view.getByRole("button", { name: "dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(view.getByRole("button", { name: "system" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  test("picks up a theme already stored before mount", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const view = render(<ThemeProbe />);
    expect(view.getByRole("status").textContent).toBe("dark/dark");
  });

  test("a second instance stays in sync when the first calls setTheme (issue #65)", () => {
    const first = render(<ThemeProbe />);
    const second = render(<ThemeProbe />);
    const firstScope = within(first.container);
    const secondScope = within(second.container);

    fireEvent.click(firstScope.getByRole("button", { name: "dark" }));

    expect(firstScope.getByRole("status").textContent).toBe("dark/dark");
    expect(secondScope.getByRole("status").textContent).toBe("dark/dark");
  });
});
