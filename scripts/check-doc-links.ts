/**
 * The doc link check (issue #82, part of the release gate): every relative
 * Markdown link in the repo must resolve to a file or directory that
 * exists, and every external link must be reachable — a HEAD request, with
 * 403/405/429 counted as reachable because those sites only refuse a plain
 * bot, not a real request. Anchored links check the file; the anchor
 * itself is the reader's to find.
 *
 *   bun run doc:check
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Mirrors biome.json's `files.ignore`, plus the VCS metadata. */
const SKIP_DIRS = new Set(["node_modules", "dist", "workflows", ".git"]);

const LINK_RE = /\]\(([^)]+)\)/g;
/** A `scheme:` prefix — `http:`, `https:`, `mailto:`, anything else. */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function isReachableStatus(status: number): boolean {
  return (
    (status >= 200 && status < 400) ||
    status === 403 ||
    status === 405 ||
    status === 429
  );
}

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findMarkdownFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(full);
    }
  }
  return found;
}

/** The path part of a link target; `null` for a same-page `#anchor`. */
function pathPartOf(target: string): string | null {
  const hash = target.indexOf("#");
  if (hash < 0) return target;
  return target.slice(0, hash) || null;
}

async function reachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
      });
      return isReachableStatus(res.status);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const files = (await findMarkdownFiles(".")).sort();
  if (files.length === 0) {
    console.error("doc:check: found no Markdown files; run from the repo root");
    process.exit(1);
  }

  const broken: string[] = [];
  const seenExternals = new Set<string>();
  let localCount = 0;
  let externalCount = 0;

  for (const file of files) {
    const content = await Bun.file(file).text();
    for (const match of content.matchAll(LINK_RE)) {
      const target = (match[1] ?? "").trim();
      if (!target) continue;
      const pathPart = pathPartOf(target);
      if (pathPart === null) continue; // a same-page anchor

      if (SCHEME_RE.test(target)) {
        if (!/^https?:/i.test(target)) continue; // mailto: and friends
        if (!seenExternals.has(target)) {
          seenExternals.add(target);
          externalCount += 1;
          if (!(await reachable(target)))
            broken.push(`external  ${file} -> ${target}`);
        }
        continue;
      }

      // A relative link: it must resolve inside the repo.
      localCount += 1;
      const resolved = path.resolve(path.dirname(file), pathPart);
      try {
        await stat(resolved);
      } catch {
        broken.push(`local     ${file} -> ${target}`);
      }
    }
  }

  console.log(
    `doc:check: ${files.length} Markdown file(s), ${localCount} local link(s), ` +
      `${externalCount} external link(s)`,
  );
  if (broken.length > 0) {
    for (const line of broken) console.error(`  broken: ${line}`);
    process.exit(1);
  }
  console.log("doc:check: all links resolve");
}

await main();
