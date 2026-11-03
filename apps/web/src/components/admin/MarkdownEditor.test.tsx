// See ../../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import "../../test/happy-dom-setup.js";

const { cleanup, render, screen } = await import("@testing-library/react");
const { MarkdownEditor } = await import("./MarkdownEditor.js");

afterEach(() => {
  cleanup();
});

function Harness({ value }: { value: string }) {
  return (
    <MarkdownEditor
      id="md"
      label="Body (Markdown)"
      value={value}
      onChange={() => {}}
      maxLength={10}
    />
  );
}

describe("MarkdownEditor", () => {
  test("renders the preview live and strips raw HTML", () => {
    render(
      <Harness value={"# Title\n\n<script>alert(1)</script>\n\n![x](y.png)"} />,
    );

    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    expect(screen.queryByText("alert(1)")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  test("counts characters against the limit", () => {
    const { rerender } = render(<Harness value="short" />);
    expect(screen.getByText("5 / 10")).toBeTruthy();

    rerender(<Harness value="way too long" />);
    const counter = screen.getByText("12 / 10");
    expect(counter).toBeTruthy();
    expect(counter.className).toContain("text-err");
  });
});
