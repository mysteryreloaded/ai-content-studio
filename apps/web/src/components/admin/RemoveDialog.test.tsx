// Issue #209, QA round 1: the footer Cancel button called `onOpenChange`
// directly, skipping `reset()`, so a reopened dialog (e.g. Uploads' next
// row) kept the previous reason and 409 error.
import { afterEach, describe, expect, test } from "bun:test";

import "../../test/happy-dom-setup.js";

const { cleanup, render, screen } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { RemoveDialog } = await import("./RemoveDialog.js");

afterEach(() => {
  cleanup();
});

function Harness({
  open,
  onOpenChange,
}: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <RemoveDialog
      kind="Upload"
      open={open}
      onOpenChange={onOpenChange}
      onRemove={() => Promise.reject(new Error("not used"))}
    />
  );
}

describe("RemoveDialog", () => {
  test("Cancel resets the reason before closing, same as pressing Escape", async () => {
    let open = true;
    const onOpenChange = (next: boolean) => {
      open = next;
    };
    const { rerender } = render(
      <Harness open={open} onOpenChange={onOpenChange} />,
    );

    await userEvent.type(
      screen.getByLabelText("Reason (required, up to 500 characters)"),
      "a reason that should not survive Cancel",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(open).toBe(false);

    // Reopen the same dialog instance (as the caller would for the next row).
    rerender(<Harness open={true} onOpenChange={onOpenChange} />);

    expect(
      (
        screen.getByLabelText(
          "Reason (required, up to 500 characters)",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("");
  });
});
