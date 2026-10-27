// Issue #165: the default (neutral) <Pill> must carry a visible fill and
// readable text in both light and dark modes. Its fill comes from the
// `--color-muted` token (wired to the prototype's `--sunk`) and its text
// from `--color-muted-foreground` (wired to `--muted`) — see src/index.css.
// The old `bg-sunk text-muted` pair named colours that don't exist as
// utilities and left the default tone with no fill and near-invisible text.
import { afterEach, describe, expect, test } from "bun:test";

import "../../test/happy-dom-setup.js";

const { cleanup, render } = await import("@testing-library/react");
const { Pill } = await import("@/components/ui/pill.js");

afterEach(() => {
  cleanup();
});

describe("Pill", () => {
  test("neutral (default) tone uses the --color-muted fill and --color-muted-foreground text", () => {
    const view = render(<Pill>Queued</Pill>);
    const pill = view.getByText("Queued");

    expect(pill.className).toContain("bg-muted");
    expect(pill.className).toContain("text-muted-foreground");
    expect(pill.className).toContain("rounded-full");
    // The old fill class is not a utility in the design system.
    expect(pill.className).not.toContain("bg-sunk");
  });
});
