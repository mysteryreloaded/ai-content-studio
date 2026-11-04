// Issue #211: the load-on-scroll footer. happy-dom's IntersectionObserver
// never fires its callback (there is no layout engine), so these tests
// install a mock whose callback is triggered by hand.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import "../../test/happy-dom-setup.js";

const { cleanup, render, screen } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { InfiniteList } = await import("./InfiniteList.js");

const ORIGINAL_OBSERVER = globalThis.IntersectionObserver;

class FiringObserver {
  static all: FiringObserver[] = [];
  readonly callback: IntersectionObserverCallback;
  constructor(
    callback: IntersectionObserverCallback,
    _options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    FiringObserver.all.push(this);
  }
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
  fire(): void {
    this.callback(
      [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

afterEach(() => {
  cleanup();
  globalThis.IntersectionObserver = ORIGINAL_OBSERVER;
});

beforeEach(() => {
  FiringObserver.all = [];
  globalThis.IntersectionObserver =
    FiringObserver as unknown as typeof IntersectionObserver;
});

describe("InfiniteList", () => {
  test("the sentinel loads the next page as it nears the viewport", () => {
    let loads = 0;
    render(
      <InfiniteList
        hasMore
        isLoading={false}
        onLoadMore={() => {
          loads += 1;
        }}
      />,
    );

    expect(FiringObserver.all.length).toBe(1);
    FiringObserver.all[0]?.fire();
    expect(loads).toBe(1);
  });

  test("the button loads the next page, as the keyboard fallback", async () => {
    let loads = 0;
    render(
      <InfiniteList
        hasMore
        isLoading={false}
        onLoadMore={() => {
          loads += 1;
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loads).toBe(1);
  });

  test("while a page is loading, neither the sentinel nor the button fires", () => {
    let loads = 0;
    render(
      <InfiniteList
        hasMore
        isLoading
        onLoadMore={() => {
          loads += 1;
        }}
      />,
    );

    expect(FiringObserver.all.length).toBe(0);
    const button = screen.getByRole("button", { name: "Loading…" });
    expect(button.hasAttribute("disabled")).toBe(true);
    FiringObserver.all[0]?.fire();
    expect(loads).toBe(0);
  });

  test("the end of the list says that is everything", () => {
    render(
      <InfiniteList hasMore={false} isLoading={false} onLoadMore={() => {}} />,
    );

    expect(screen.getByText("That's everything.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(FiringObserver.all.length).toBe(0);
  });

  test("a failed page shows its message and a retry", async () => {
    let loads = 0;
    render(
      <InfiniteList
        hasMore
        isLoading={false}
        error="could not load older entries"
        onLoadMore={() => {
          loads += 1;
        }}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "could not load older entries",
    );
    expect(FiringObserver.all.length).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(loads).toBe(1);
  });
});
