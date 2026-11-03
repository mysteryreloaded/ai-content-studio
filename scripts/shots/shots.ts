#!/usr/bin/env bun
// The shots tool (issue #187): a developer tool, not a test. Boots the
// studio on a fresh database, seeds it through its own API, signs in
// headless as each kind of user, and saves full-page PNGs of every route
// at 360px and 1280px in light and dark, alongside the matching views of
// the agreed prototypes.
//
//   bun scripts/shots/shots.ts [--only a,b] [--no-build] [--no-prototype] [--keep] [--list] [--publish <PR number>]
//
// Never run in CI or under `bun test`.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { createClient } from "./client.js";
import {
  PROTOTYPE_VIEWS,
  extractPrototypes,
  openPrototypeView,
} from "./prototype.js";
import {
  type Identity,
  routes as ROUTE_TABLE,
  type Route,
  WIDTHS,
} from "./routes.js";
import { type SeedResult, seedShots } from "./seed-shots.js";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");
const SHOTS_DIR = path.join(REPO_ROOT, ".shots");

interface Args {
  only: string[] | null;
  noBuild: boolean;
  noPrototype: boolean;
  keep: boolean;
  list: boolean;
  publish: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    only: null,
    noBuild: false,
    noPrototype: false,
    keep: false,
    list: false,
    publish: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only")
      args.only = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (arg === "--no-build") args.noBuild = true;
    else if (arg === "--no-prototype") args.noPrototype = true;
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--list") args.list = true;
    else if (arg === "--publish") args.publish = argv[++i] ?? null;
  }
  return args;
}

type BrowserLaunchOptions = { channel?: "chrome"; executablePath?: string };

async function checkPreflight(): Promise<{
  launchOptions: BrowserLaunchOptions;
}> {
  const docker = Bun.spawnSync(["docker", "version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (docker.exitCode !== 0) {
    console.error(
      "shots: docker isn't available. Install Docker and try again.",
    );
    process.exit(1);
  }
  const ffmpeg = Bun.spawnSync(["ffmpeg", "-version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (ffmpeg.exitCode !== 0) {
    console.error(
      "shots: ffmpeg isn't available. Install ffmpeg and try again.",
    );
    process.exit(1);
  }

  const envChrome = process.env.SHOTS_CHROME;
  if (envChrome) {
    const exists = await Bun.file(envChrome).exists();
    if (!exists) {
      console.error(`shots: SHOTS_CHROME=${envChrome} doesn't exist.`);
      process.exit(1);
    }
    return { launchOptions: { executablePath: envChrome } };
  }

  try {
    const probe = await chromium.launch({ channel: "chrome", headless: true });
    await probe.close();
    return { launchOptions: { channel: "chrome" } };
  } catch {
    // No system Chrome: fall back to playwright-core's own bundled
    // Chromium (`bunx playwright-core install chromium`), instead of
    // always trying "chrome" and never actually using it.
    try {
      const probe = await chromium.launch({ headless: true });
      await probe.close();
      return { launchOptions: {} };
    } catch {
      console.error(
        "shots: no Chrome or Chromium found. Set SHOTS_CHROME=<path>, or run `bunx playwright-core install chromium`.",
      );
      process.exit(1);
    }
  }
}

function runFolderName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const sha = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
    cwd: REPO_ROOT,
  })
    .stdout.toString()
    .trim();
  return `${stamp}-${sha}`;
}

async function recreateDatabase(pgUrl: string, dbName: string): Promise<void> {
  const { SQL } = await import("bun");
  const admin = new SQL(pgUrl);
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.close();
  }
}

async function makeMedia(mediaDir: string): Promise<void> {
  await mkdir(mediaDir, { recursive: true });
  const run = (args: string[]) =>
    Bun.spawnSync(["ffmpeg", "-y", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

  const checks: { label: string; result: ReturnType<typeof run> }[] = [];
  checks.push({
    label: "start.png",
    result: run([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=832x480",
      "-frames:v",
      "1",
      path.join(mediaDir, "start.png"),
    ]),
  });
  checks.push({
    label: "voice.wav",
    result: run([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      path.join(mediaDir, "voice.wav"),
    ]),
  });
  checks.push({
    label: "source.mp4",
    result: run([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=832x480:rate=25",
      "-t",
      "4",
      "-pix_fmt",
      "yuv420p",
      path.join(mediaDir, "source.mp4"),
    ]),
  });
  checks.push({
    label: "out-wide.mp4",
    result: run([
      "-f",
      "lavfi",
      "-i",
      "mandelbrot=size=832x480:rate=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      "-t",
      "4",
      "-pix_fmt",
      "yuv420p",
      "-shortest",
      path.join(mediaDir, "out-wide.mp4"),
    ]),
  });
  checks.push({
    label: "out-tall.mp4",
    result: run([
      "-f",
      "lavfi",
      "-i",
      "mandelbrot=size=480x832:rate=25",
      "-t",
      "4",
      "-pix_fmt",
      "yuv420p",
      path.join(mediaDir, "out-tall.mp4"),
    ]),
  });
  checks.push({
    label: "out.png",
    result: run([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=832x480",
      "-frames:v",
      "1",
      path.join(mediaDir, "out.png"),
    ]),
  });

  for (const { label, result } of checks) {
    if (result.exitCode !== 0) {
      throw new Error(
        `shots: ffmpeg failed making ${label}: ${result.stderr.toString().slice(-2000)}`,
      );
    }
  }
}

interface Children {
  fake: ReturnType<typeof Bun.spawn> | null;
  server: ReturnType<typeof Bun.spawn> | null;
}

async function waitForHealthz(base: string, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      const res = await fetch(new URL("/healthz", base));
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error("shots: the server never answered /healthz");
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function stopChildren(children: Children): void {
  children.server?.kill();
  children.fake?.kill();
}

// No route runs as Dana or Quinn — they only need to exist as rows (a
// disabled account, a second pending user), which `seedShots` creates
// through its own API client — so only the identities routes.ts actually
// signs in as get a browser session here.
const IDENTITIES: { id: Identity; email: string; name: string }[] = [
  { id: "alice", email: "alice@example.com", name: "Alice Admin" },
  { id: "sam", email: "sam.park@example.com", name: "Sam Park" },
  { id: "robin", email: "robin@example.com", name: "Robin New" },
  { id: "pat", email: "pat@example.com", name: "Pat Pending" },
];

/** Resolves `{a.b}` placeholders in a route's path template against `seed.json`'s shape. */
function resolvePath(template: string, seed: SeedResult): string {
  return template.replace(/\{([\w.]+)\}/g, (_match, key: string) => {
    const parts = key.split(".");
    let value: unknown = seed;
    for (const part of parts) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    if (value === undefined)
      throw new Error(`shots: unresolved placeholder {${key}}`);
    return String(value);
  });
}

interface SkippedEntry {
  name: string;
  reason: string;
}

async function waitSettled(page: Page, ready?: string): Promise<void> {
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  if (ready) {
    await page.locator(ready).first().waitFor({ timeout: 5000 });
  }
  await page.waitForTimeout(300);
}

/**
 * One navigation (and one run of `route.actions`) per (route, theme):
 * every width in `widths` is then just a `page.setViewportSize` and a
 * screenshot, instead of a fresh `page.goto` — this is the app's own
 * local server, but Chromium context/page setup still dominates the
 * cost otherwise (issue #187's 5-minute budget).
 */
async function shootRoute(
  context: BrowserContext,
  base: string,
  route: Route,
  seed: SeedResult,
  widths: readonly number[],
  appDir: string,
  /**
   * `route.name` -> the URL its actions landed on last time. An action
   * can be a real, one-time mutation (e.g. accepting Site terms), so a
   * route with actions only runs them once; every later theme for that
   * same route just opens the URL the first run reached.
   */
  actionedUrls: Map<string, string>,
): Promise<{ width: number; error: string }[]> {
  const page = await context.newPage();
  const errors: { width: number; error: string }[] = [];
  try {
    const alreadyActioned = actionedUrls.get(route.name);
    const url = new URL(alreadyActioned ?? resolvePath(route.path, seed), base);
    await page.goto(url.toString());

    if (!alreadyActioned) {
      for (const action of route.actions ?? []) {
        try {
          await page
            .getByRole(action.role as Parameters<Page["getByRole"]>[0], {
              name: action.name,
            })
            .first()
            .click({ timeout: 5000 });
        } catch {
          // A looser fallback for a page whose accessible role/name
          // don't match exactly yet (section 5: markup still changes
          // under later restyle tickets).
          await page.getByText(action.name, { exact: true }).first().click({
            timeout: 5000,
          });
        }
      }
    }

    await waitSettled(page, route.ready);

    // Captured only now: an action (e.g. accepting Site terms) can kick
    // off a client-side navigation (`/models` -> `/waiting`) that hasn't
    // landed yet right after the click, so grabbing `page.url()` earlier
    // cached the pre-navigation URL and every later theme replayed that
    // stale page instead of the one `route.ready` actually waited for.
    if (!alreadyActioned && route.actions?.length) {
      actionedUrls.set(route.name, page.url());
    }

    const themeLabel = (await page.evaluate(() =>
      matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    )) as "dark" | "light";

    for (const width of widths) {
      try {
        await page.setViewportSize({ width, height: 800 });
        const file = path.join(
          appDir,
          `${route.name}-${width}-${themeLabel}.png`,
        );
        await page.screenshot({
          path: file,
          fullPage: route.fullPage ?? true,
          animations: "disabled",
          caret: "hide",
        });
      } catch (err) {
        errors.push({
          width,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    for (const width of widths) {
      errors.push({
        width,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  return errors;
}

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/**
 * One real sign-in per identity (section 3): the saved storage state is
 * then reused to build a fresh context for every width/theme pair,
 * instead of resizing one shared context (Playwright has no
 * `context.setViewportSize`, only `page.setViewportSize`, which doesn't
 * change a context's `colorScheme`).
 */
async function signInStorageStates(
  base: string,
  browser: Browser,
): Promise<Map<Identity, StorageState>> {
  const byIdentity = new Map<Identity, StorageState>();

  for (const identity of IDENTITIES) {
    const signInContext = await browser.newContext();
    const page = await signInContext.newPage();
    await page.goto(
      new URL("/api/auth/google?return_to=/models", base).toString(),
    );
    await page.locator('input[name="mock_email"]').fill(identity.email);
    await page.locator('input[name="mock_name"]').fill(identity.name);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.toString().includes("/mock-oidc"), {
      timeout: 10_000,
    });

    // Issue #187 section 3's fallback: if Chromium ever drops the
    // Secure `__Host-session` cookie on http://localhost, sign in again
    // through this identity's own real API jar instead.
    let storageState = await signInContext.storageState();
    const hasSession = storageState.cookies.some(
      (cookie) => cookie.name === "__Host-session",
    );
    if (!hasSession) {
      const client = await createClient(base, identity.email, identity.name);
      const sessionValue = client
        .cookieHeader()
        .split("; ")
        .find((pair) => pair.startsWith("__Host-session="))
        ?.slice("__Host-session=".length);
      if (!sessionValue) {
        throw new Error(
          `shots: sign-in as ${identity.email} set no __Host-session cookie, in Chromium or via the API`,
        );
      }
      await signInContext.addCookies([
        {
          name: "__Host-session",
          value: sessionValue,
          url: base,
          secure: true,
          httpOnly: true,
          path: "/",
        },
      ]);
      storageState = await signInContext.storageState();
    }
    await signInContext.close();

    byIdentity.set(identity.id, storageState);
  }

  return byIdentity;
}

async function contextFor(
  browser: Browser,
  storageState: StorageState | undefined,
  width: number,
  theme: "light" | "dark",
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: theme,
    reducedMotion: "reduce",
    locale: "en-GB",
    timezoneId: "Europe/London",
    storageState,
  });
}

async function writeContactSheet(
  run: string,
  skipped: SkippedEntry[],
  selectedRoutes: Route[],
): Promise<void> {
  const rows = selectedRoutes
    .map((route) => {
      const widths = route.widths ?? [...WIDTHS];
      const cells = widths
        .flatMap((width) =>
          ["light", "dark"].map((theme) => `${width}-${theme}`),
        )
        .map(
          (suffix) =>
            `<td><img src="app/${route.name}-${suffix}.png" loading="lazy" width="200"></td>`,
        )
        .join("");
      const protoRow = route.prototype
        ? `<tr><td colspan="4">prototype: ${route.prototype}</td></tr><tr>${[
            "360-light",
            "360-dark",
            "1280-light",
            "1280-dark",
          ]
            .map(
              (suffix) =>
                `<td><img src="prototype/${route.prototype}-${suffix}.png" loading="lazy" width="200"></td>`,
            )
            .join("")}</tr>`
        : "";
      return `<tr><th colspan="4">${route.name}</th></tr><tr>${cells}</tr>${protoRow}`;
    })
    .join("\n");

  const skippedList = skipped.length
    ? `<ul>${skipped.map((s) => `<li>skipped: ${s.name}: ${s.reason}</li>`).join("")}</ul>`
    : "<p>Nothing skipped.</p>";

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Shots</title></head>
<body>
<h1>Shots contact sheet</h1>
${skippedList}
<table>${rows}</table>
</body></html>`;
  await writeFile(path.join(run, "index.html"), html);
}

/** Runs `args`, throwing with its captured output if it exits non-zero. */
function sh(args: string[], cwd?: string, inherit = false): void {
  const result = Bun.spawnSync(args, {
    cwd,
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
  });
  if (result.exitCode !== 0) {
    const detail = inherit ? "" : `: ${result.stderr.toString().slice(-2000)}`;
    throw new Error(
      `shots: \`${args.join(" ")}\` failed (exit ${result.exitCode})${detail}`,
    );
  }
}

async function publish(
  run: string,
  prNumber: string,
  only: string[] | null,
): Promise<void> {
  const branch = `shots/pr-${prNumber}`;
  const worktreeDir = path.join(REPO_ROOT, ".shots-publish-worktree");
  await rm(worktreeDir, { recursive: true, force: true });

  const branchExists =
    Bun.spawnSync(["git", "rev-parse", "--verify", `origin/${branch}`], {
      cwd: REPO_ROOT,
    }).exitCode === 0;

  if (branchExists) {
    sh(
      ["git", "worktree", "add", "-B", branch, worktreeDir, `origin/${branch}`],
      REPO_ROOT,
      true,
    );
  } else {
    sh(["git", "worktree", "add", "--detach", worktreeDir], REPO_ROOT, true);
    sh(["git", "checkout", "--orphan", branch], worktreeDir, true);
    sh(["git", "rm", "-rf", "--quiet", "."], worktreeDir);
  }

  sh(["cp", "-r", path.join(run, "app"), worktreeDir]);
  sh(["cp", "-r", path.join(run, "prototype"), worktreeDir]);
  sh(["git", "add", "-A"], worktreeDir);
  const commitLabel = only ? only.join(",") : "all";
  sh(
    ["git", "commit", "-m", `Shots for PR #${prNumber} (${commitLabel})`],
    worktreeDir,
  );
  sh(["git", "push", "-u", "origin", branch], worktreeDir, true);

  await rm(worktreeDir, { recursive: true, force: true });
  Bun.spawnSync(["git", "worktree", "prune"], { cwd: REPO_ROOT });

  console.log(`\nPublished to branch ${branch}. Markdown table:\n`);
  console.log(
    "| route | 360 light | 360 dark | 1280 light | 1280 dark | prototype |",
  );
  console.log("|---|---|---|---|---|---|");
  const selected = only
    ? ROUTE_TABLE.filter((r) => only.includes(r.name))
    : ROUTE_TABLE;
  for (const route of selected) {
    const link = (file: string) =>
      `[img](https://github.com/mysteryreloaded/ai-content-studio/blob/${branch}/${file}?raw=true)`;
    const proto = route.prototype
      ? link(`prototype/${route.prototype}-1280-light.png`)
      : "";
    console.log(
      `| ${route.name} | ${link(`app/${route.name}-360-light.png`)} | ${link(`app/${route.name}-360-dark.png`)} | ${link(`app/${route.name}-1280-light.png`)} | ${link(`app/${route.name}-1280-dark.png`)} | ${proto} |`,
    );
  }
  console.log(
    `\n(the ${branch} branch can be deleted once this PR has merged.)`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log("Routes:");
    for (const route of ROUTE_TABLE) console.log(`  ${route.name}`);
    console.log("\nPrototype views:");
    for (const view of PROTOTYPE_VIEWS) console.log(`  ${view.name}`);
    return;
  }

  const { launchOptions } = await checkPreflight();
  const t0 = Date.now();
  const log = (msg: string) =>
    console.log(`shots: [+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  const runName = runFolderName();
  const run = path.join(SHOTS_DIR, runName);
  const appDir = path.join(run, "app");
  const protoDir = path.join(run, "prototype");
  const mediaDir = path.join(run, "media");
  const logsDir = path.join(run, "logs");
  const dataDir = path.join(run, "data");
  await Promise.all(
    [appDir, protoDir, mediaDir, logsDir, dataDir].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  );

  const pgUrl =
    process.env.SHOTS_PG_URL ??
    "postgres://postgres:postgres@localhost:5432/postgres";
  const dbName = "ai_content_studio_shots";
  log("recreating the database...");
  await recreateDatabase(pgUrl, dbName);
  const dbUrl = new URL(pgUrl);
  dbUrl.pathname = `/${dbName}`;

  log("making media with ffmpeg...");
  await makeMedia(mediaDir);

  const fakePort = Number(process.env.SHOTS_FAKE_PORT ?? 8188);
  const fakeComfyUiUrl = `http://localhost:${fakePort}`;
  const serverPort = 3100;
  const base = `http://localhost:${serverPort}`;

  const children: Children = { fake: null, server: null };
  const fakeLog = Bun.file(path.join(logsDir, "fake-comfyui.log"));
  const serverLog = Bun.file(path.join(logsDir, "server.log"));

  async function cleanup(): Promise<void> {
    if (args.keep) return;
    stopChildren(children);
  }
  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });

  try {
    log("starting the fake ComfyUI...");
    children.fake = Bun.spawn(
      ["bun", "run", "apps/fake-comfyui/src/server.ts"],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, PORT: String(fakePort) },
        stdout: fakeLog,
        stderr: fakeLog,
      },
    );

    if (!args.noBuild) {
      log("building the app...");
      const build = Bun.spawnSync(["bun", "run", "build"], {
        cwd: REPO_ROOT,
        stdout: "inherit",
        stderr: "inherit",
      });
      if (build.exitCode !== 0)
        throw new Error("shots: `bun run build` failed");
    }

    log("starting the server...");
    children.server = Bun.spawn(["bun", "run", "apps/server/src/index.ts"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(serverPort),
        PUBLIC_URL: base,
        OIDC_ISSUER: `${base}/mock-oidc`,
        ADMIN_EMAILS: "alice@example.com",
        DATA_DIR: dataDir,
        DATABASE_URL: dbUrl.toString(),
        GOOGLE_CLIENT_ID: "shots-client-id",
        GOOGLE_CLIENT_SECRET: "shots-client-secret",
        SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
        // A dev `.env` may set this to false; the shots tool needs real
        // Backend contact (health, enable) against the fake ComfyUI.
        BACKENDS_ENABLED: "true",
      },
      stdout: serverLog,
      stderr: serverLog,
    });

    await waitForHealthz(base, 60_000);
    log("server is up");

    log("seeding...");
    const seed = await seedShots(base, fakeComfyUiUrl, mediaDir);
    await writeFile(path.join(run, "seed.json"), JSON.stringify(seed, null, 2));
    log("seeded");

    if (args.keep) {
      console.log(`\nshots: --keep: the studio is running at ${base}`);
      console.log(
        "Sign-in emails: alice@example.com, sam.park@example.com, robin@example.com, pat@example.com, quinn@example.com, dana@example.com, eve@example.com",
      );
      console.log("Press Ctrl-C to stop.\n");
      await new Promise(() => {
        // runs until SIGINT
      });
      return;
    }

    const selectedRoutes = args.only
      ? ROUTE_TABLE.filter((r) => args.only?.includes(r.name))
      : ROUTE_TABLE;

    log("launching the browser...");
    const browser = await chromium.launch({ headless: true, ...launchOptions });

    const identityStorageStates = await signInStorageStates(base, browser);
    const skipped: SkippedEntry[] = [];
    const actionedUrls = new Map<string, string>();
    let sitePaused = false;

    for (const route of selectedRoutes) {
      // The three `*-paused` routes (kept last in ROUTE_TABLE) need the
      // site actually paused; nothing else in this run ever calls that
      // endpoint, so pause it once, as Alice, right before the first one.
      if (!sitePaused && route.name.endsWith("-paused")) {
        const alice = await createClient(
          base,
          "alice@example.com",
          "Alice Admin",
        );
        await alice.api("POST", "/api/admin/site-settings/pause");
        sitePaused = true;
      }
      const widths = route.widths ?? [...WIDTHS];
      for (const theme of ["light", "dark"] as const) {
        const storageState =
          route.as === "signed-out"
            ? undefined
            : identityStorageStates.get(route.as);
        if (route.as !== "signed-out" && !storageState) {
          skipped.push({
            name: route.name,
            reason: `no identity context for ${route.as}`,
          });
          continue;
        }
        const context = await contextFor(
          browser,
          storageState,
          widths[0] ?? WIDTHS[0],
          theme,
        );
        const errors = await shootRoute(
          context,
          base,
          route,
          seed,
          widths,
          appDir,
          actionedUrls,
        );
        for (const { width, error } of errors) {
          skipped.push({ name: `${route.name} (${width}px)`, reason: error });
        }
        await context.close();
      }
    }

    // ~80 sequential contexts on the one app-shooting browser can leave it
    // unstable (or outright closed) by the time we get here, so the
    // prototype phase gets its own browser instead of reusing it.
    await browser.close().catch(() => undefined);
    let prototypeBrowser: Browser | null = null;

    const launchPrototypeBrowser = () =>
      chromium.launch({ headless: true, ...launchOptions });

    if (!args.noPrototype) {
      log("extracting prototypes...");
      await extractPrototypes(REPO_ROOT, run);
      // One page load per (view, theme): a context's `colorScheme` is
      // fixed at creation, but `page.setViewportSize` doesn't reload the
      // page, so both widths share the one real navigation and click
      // sequence (section 7's clicks simulate progress and cost real
      // wall-clock time, and cdnjs/Google Fonts are real network calls).
      //
      // A browser kept alive across the whole phase reliably dies partway
      // through (observed consistently at the 12th context, regardless of
      // which views land there) — something in the extracted prototypes'
      // own navigation/rendering destabilizes the shared browser process,
      // not just a context. Rather than depend on that, relaunch a fresh
      // browser before every view so no instance ever opens more than the
      // two contexts (light/dark) that view needs.
      for (const view of PROTOTYPE_VIEWS) {
        await prototypeBrowser?.close().catch(() => undefined);
        prototypeBrowser = await launchPrototypeBrowser();
        for (const theme of ["light", "dark"] as const) {
          let ctx: BrowserContext | undefined;
          try {
            ctx = await prototypeBrowser.newContext({
              viewport: { width: WIDTHS[0], height: 800 },
              deviceScaleFactor: 1,
              colorScheme: theme,
              reducedMotion: "reduce",
              locale: "en-GB",
              timezoneId: "Europe/London",
            });
            const page = await openPrototypeView(ctx, run, view);
            for (const width of WIDTHS) {
              await page.setViewportSize({ width, height: 800 });
              await page.waitForTimeout(300);
              await page.screenshot({
                path: path.join(protoDir, `${view.name}-${width}-${theme}.png`),
                fullPage: true,
                animations: "disabled",
                caret: "hide",
              });
            }
          } catch (err) {
            skipped.push({
              name: `prototype:${view.name}-${theme}`,
              reason: err instanceof Error ? err.message : String(err),
            });
          } finally {
            await ctx?.close().catch(() => undefined);
          }
        }
      }
    }

    await prototypeBrowser?.close().catch(() => undefined);

    log("writing the contact sheet...");
    await writeContactSheet(run, skipped, selectedRoutes);

    for (const s of skipped) console.log(`skipped: ${s.name}: ${s.reason}`);

    console.log(`\nshots: done. ${run}`);

    if (args.publish) {
      await publish(run, args.publish, args.only);
    }
  } finally {
    await cleanup();
  }
}

await main();
