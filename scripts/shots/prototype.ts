// The prototype views (issue #187, section 7): extracted from the two
// prototype branches without reading them, driven by clicks only. No
// agent ever opens `index.html` or `artifact.html` — only the browser
// does, from the extracted copy under the run folder.

import { mkdir } from "node:fs/promises";
import type { BrowserContext } from "playwright-core";

export interface ProtoClick {
  /** CSS selector; the prototype has no URL routing, so views are reached by clicks. */
  selector: string;
  text?: string;
}

export interface ProtoView {
  name: string;
  branch: "model-page" | "model-editor";
  path: string;
  /** Clicks to reach this view from the extracted page's default load. */
  clicks?: ProtoClick[];
  queryVariant?: "a" | "b" | "c";
  /** Set `#proto-scenario` to this value before any click (the `first-visit` view). */
  scenario?: string;
}

export const PROTOTYPE_VIEWS: ProtoView[] = [
  { name: "home", branch: "model-page", path: "prototypes/model-page" },
  {
    name: "workbench",
    branch: "model-page",
    path: "prototypes/model-page",
    clicks: [{ selector: ".app-nav button", text: "LTX 2.5" }],
  },
  {
    name: "workbench-one-mode",
    branch: "model-page",
    path: "prototypes/model-page",
    clicks: [{ selector: ".app-nav button", text: "Wan 2.2" }],
  },
  {
    name: "gallery",
    branch: "model-page",
    path: "prototypes/model-page",
    clicks: [{ selector: ".app-nav button", text: "Gallery" }],
  },
  {
    name: "detail",
    branch: "model-page",
    path: "prototypes/model-page",
    clicks: [
      { selector: ".app-nav button", text: "LTX 2.5" },
      { selector: "button", text: "Details" },
    ],
  },
  {
    name: "first-visit",
    branch: "model-page",
    path: "prototypes/model-page",
    scenario: "first",
    clicks: [{ selector: ".app-nav button", text: "LTX 2.5" }],
  },
  {
    name: "editor-a",
    branch: "model-editor",
    path: "prototypes/model-editor",
    queryVariant: "a",
  },
  {
    name: "editor-b",
    branch: "model-editor",
    path: "prototypes/model-editor",
    queryVariant: "b",
  },
  {
    name: "editor-c",
    branch: "model-editor",
    path: "prototypes/model-editor",
    queryVariant: "c",
  },
];

/** `git archive` the two prototype branches into `<run>/proto/`, never reading either file. */
export async function extractPrototypes(
  repoRoot: string,
  run: string,
): Promise<void> {
  const protoDir = `${run}/proto`;
  await mkdir(protoDir, { recursive: true });
  for (const [branch, subpath] of [
    ["origin/prototype/model-page", "prototypes/model-page"],
    ["origin/prototype/model-editor", "prototypes/model-editor"],
  ] as const) {
    const proc = Bun.spawn(
      [
        "sh",
        "-c",
        `git archive ${branch} ${subpath} | tar -x -C "${protoDir}"`,
      ],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(
        `shots: git archive ${branch} failed: ${err.slice(0, 1000)}`,
      );
    }
  }
}

async function waitSettled(
  page: import("playwright-core").Page,
): Promise<void> {
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
}

/** Opens `view` in a fresh page under `context`, hides the prototype toolbar, and returns the ready page. */
export async function openPrototypeView(
  context: BrowserContext,
  run: string,
  view: ProtoView,
): Promise<import("playwright-core").Page> {
  const page = await context.newPage();
  const url = `file://${run}/proto/${view.path}/index.html${
    view.queryVariant ? `?variant=${view.queryVariant}` : ""
  }`;
  await page.goto(url);
  await waitSettled(page);
  await page.addStyleTag({ content: ".proto-bar{display:none}" });

  if (view.scenario) {
    await page
      .locator("#proto-scenario")
      .selectOption(view.scenario)
      .catch(() => undefined);
  }

  for (const click of view.clicks ?? []) {
    const locator = click.text
      ? page.locator(click.selector).filter({ hasText: click.text }).first()
      : page.locator(click.selector).first();
    await locator.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }

  return page;
}
