// Issue #165: the default <Button> must pick up the Admin's brand accent
// through the `--primary` token (wired to the server-injected `--accent`
// in src/index.css), and the spec'd `danger` variant and sm/xs/icon sizes
// must be available for the Workbench restyle.
import { afterEach, describe, expect, test } from "bun:test";

import "../../test/happy-dom-setup.js";

const { cleanup, render } = await import("@testing-library/react");
const { Button } = await import("@/components/ui/button.js");

afterEach(() => {
  cleanup();
});

describe("Button", () => {
  test("default variant uses the brand-accent --primary token", () => {
    const view = render(<Button>Generate</Button>);
    const button = view.getByRole("button", { name: "Generate" });

    expect(button.className).toContain("bg-primary");
    expect(button.className).toContain("text-primary-foreground");
  });

  test("danger variant uses the --err token, not the accent", () => {
    const view = render(<Button variant="danger">Delete model</Button>);
    const button = view.getByRole("button", { name: "Delete model" });

    expect(button.className).toContain("text-err");
    expect(button.className).not.toContain("bg-primary");
  });

  test("offers the spec'd xs, sm and icon sizes", () => {
    render(
      <>
        <Button size="xs">Tiny</Button>
        <Button size="sm">Small</Button>
        <Button size="icon" aria-label="Open menu" />
      </>,
    );

    const tiny = document.querySelector('button[data-size="xs"]');
    const small = document.querySelector('button[data-size="sm"]');
    const icon = document.querySelector('button[data-size="icon"]');

    expect(tiny?.className).toContain("h-6");
    expect(small?.className).toContain("h-7");
    expect(icon?.className).toContain("size-8");
  });
});
