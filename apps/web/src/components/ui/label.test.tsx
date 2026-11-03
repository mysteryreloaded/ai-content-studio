// Issue #222 QA round 1: the Label primitive must not force a 40px row —
// that collapsed the 6-8px label-to-control gap on /account (space-y-1.5
// around a Label + Input). A control+text row's own 40px/10px-gap sizing
// lives on the row (e.g. NotificationsSwitch), not on Label.
import { afterEach, describe, expect, test } from "bun:test";

import "../../test/happy-dom-setup.js";

const { cleanup, render } = await import("@testing-library/react");
const { Label } = await import("@/components/ui/label.js");

afterEach(() => {
  cleanup();
});

describe("Label", () => {
  test("does not force a 40px row", () => {
    render(<Label htmlFor="field">Field</Label>);
    const label = document.querySelector("label");

    expect(label?.className).not.toContain("min-h-10");
  });
});
