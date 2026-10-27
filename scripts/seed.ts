/**
 * The upgrade check's seed (issue #82): one standalone script, no
 * dependencies, that puts a working studio through its own API — an Admin
 * signing in through the in-repo mock OIDC issuer, the Site settings with
 * a logo, one registered Backend, one enabled Model with one Mode, and one
 * complete Upload — so the database and /data hold the shape of a used
 * installation when the upgrade check reboots it under a newer image.
 *
 * Run it against a running studio whose env has OIDC_ISSUER set (the mock
 * issuer mounts at that URL's path):
 *
 *   SEED_BASE_URL=http://localhost:3000 \
 *   SEED_ADMIN_EMAIL=admin@example.com \
 *   SEED_BACKEND_URL=http://172.28.100.1:8189 \
 *   bun run scripts/seed.ts
 */

const BASE = process.env.SEED_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
/** The fake ComfyUI's address as seen from inside the studio container. Blank skips the Backend (and the Model). */
const BACKEND_URL = process.env.SEED_BACKEND_URL ?? "";

const origin = new URL(BASE).origin;

/** A 1×1 transparent PNG, the smallest real image the media module will process. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_BYTES = Uint8Array.from(
  atob(PNG_BASE64)
    .split("")
    .map((ch) => ch.charCodeAt(0)),
);

function fail(step: string, res: Response, body: string): never {
  console.error(`seed: ${step} failed: HTTP ${res.status} ${res.statusText}`);
  if (body) console.error(body.slice(0, 4000));
  throw new Error(`seed: ${step} failed: HTTP ${res.status}`);
}

const cookieJar: Record<string, string> = {};

function absorbCookies(res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const first = line.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq > 0) cookieJar[first.slice(0, eq).trim()] = first.slice(eq + 1);
  }
}

function cookieHeader(): string {
  return Object.entries(cookieJar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function api(
  method: string,
  path: string,
  body?: RequestInit["body"] | { json: unknown } | { form: FormData },
): Promise<Response> {
  const headers: Record<string, string> = {
    // The same-origin guard: every non-GET/HEAD request must carry it.
    Origin: origin,
    Cookie: cookieHeader(),
  };
  let payload: RequestInit["body"];
  // Raw bodies first: Bun's Blob carries a `json()` method on its
  // prototype, so the `"json" in body` wrapper check below would see a
  // Blob and stringify `undefined` instead of the bytes.
  if (
    typeof body === "string" ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    ArrayBuffer.isView(body)
  ) {
    // The fetch API sets its own Content-Type for these.
    payload = body;
  } else if (body != null && "json" in (body as object)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify((body as { json: unknown }).json);
  } else if (body != null && "form" in (body as object)) {
    payload = (body as { form: FormData }).form;
  } else {
    payload = body;
  }
  const res = await fetch(new URL(path, origin), {
    method,
    headers,
    body: payload,
    redirect: "manual",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    fail(path, res, text);
  }
  return res;
}

async function asJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Signs in as `email` through the mock issuer's two-hop redirect chain, keeping the flow cookies in the jar by hand. */
async function signIn(email: string): Promise<void> {
  const first = await fetch(new URL("/api/auth/google", origin), {
    redirect: "manual",
  });
  const firstLocation = first.headers.get("location");
  if (first.status !== 302 || !firstLocation) {
    fail("sign in", first, await first.text().catch(() => ""));
  }
  absorbCookies(first);

  const authorize = new URL(firstLocation);
  authorize.searchParams.set("mock_email", email);
  authorize.searchParams.set("mock_name", "Upgrade seed");
  authorize.searchParams.set("mock_email_verified", "true");

  const second = await fetch(authorize, {
    redirect: "manual",
    headers: { Cookie: cookieHeader() },
  });
  const secondLocation = second.headers.get("location");
  if (second.status !== 302 || !secondLocation) {
    fail("sign in (mock issuer)", second, await second.text().catch(() => ""));
  }
  absorbCookies(second);

  const callback = await fetch(new URL(secondLocation), {
    redirect: "manual",
    headers: { Cookie: cookieHeader() },
  });
  if (callback.status !== 302) {
    fail("sign in (callback)", callback, await callback.text().catch(() => ""));
  }
  absorbCookies(callback);

  if (!cookieJar["__Host-session"]) {
    throw new Error("seed: the sign-in callback set no session cookie");
  }
  console.log(`seed: signed in as ${email}`);
}

async function seedSiteSettings(): Promise<void> {
  const current = await asJson<{ version: number }>(
    await api("GET", "/api/admin/site-settings"),
  );
  const form = new FormData();
  form.set("version", String(current.version));
  form.set("title", "Upgrade Seed");
  form.set("landingText", "");
  form.set("accent", "teal");
  form.set("signUpMode", "approval");
  form.set("contact", "");
  form.set("footerLinks", "[]");
  form.set(
    "logo",
    new File([PNG_BYTES], "seed-logo.png", { type: "image/png" }),
  );
  await api("PUT", "/api/admin/site-settings", { form });
  console.log("seed: site settings (title + logo)");
}

async function seedBackend(): Promise<string | null> {
  if (!BACKEND_URL) {
    console.log(
      "seed: no SEED_BACKEND_URL; skipping the Backend and the Model",
    );
    return null;
  }
  const res = await api("POST", "/api/admin/backends", {
    json: { name: "Seed GPU", baseUrl: BACKEND_URL, auth: "none" },
  });
  const backend = await asJson<{ id: string }>(res);
  console.log(`seed: backend at ${BACKEND_URL}`);
  return backend.id;
}

/** The same shape the contract suite's weightless Workflows use: a real, node-checkable graph. */
function seedWorkflow(): Record<string, unknown> {
  return {
    "1": {
      class_type: "EmptyImage",
      inputs: { width: 8, height: 8, batch_size: 1, color: 0 },
    },
    "2": {
      class_type: "TestSleep",
      inputs: { value: ["1", 0], seconds: 1 },
    },
    "3": {
      class_type: "SaveImage",
      inputs: { images: ["2", 0], filename_prefix: "upgrade-seed" },
    },
  };
}

/**
 * The health monitor's first `/system_stats` poll lands 30s after a
 * Backend is created, and the enable gate only counts a Backend it has
 * already seen reachable — so wait for that first poll to land before
 * enabling (up to two minutes; a healthy fake answers in milliseconds).
 */
async function waitReachable(backendId: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let last = "unknown";
  for (;;) {
    const list = await asJson<{
      backends: { id: string; health: { reachability: string } }[];
    }>(await api("GET", "/api/admin/backends"));
    last =
      list.backends.find((b) => b.id === backendId)?.health.reachability ??
      last;
    if (last === "reachable") {
      console.log("seed: backend reachable (health monitor's first poll done)");
      return;
    }
    if (Date.now() > deadline)
      throw new Error(
        `seed: the backend never became reachable (last: ${last})`,
      );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function seedModel(backendId: string): Promise<void> {
  const modelRes = await api("POST", "/api/admin/models", {
    json: { name: "Seed Images", workflow: seedWorkflow() },
  });
  const model = await asJson<{ model: { id: string; version: number } }>(
    modelRes,
  );
  let version = model.model.version;

  const modesRes = await api(
    "PUT",
    `/api/admin/models/${model.model.id}/modes`,
    {
      json: {
        version,
        modes: [
          {
            name: "Images",
            description: "The upgrade check's own Model.",
            outputNodeIds: ["3"],
            inputSettings: [],
          },
        ],
      },
    },
  );
  version = (await asJson<{ record: { version: number } }>(modesRes)).record
    .version;

  // 204 with no body: the attach lands in its own table and does not bump
  // the Model's version, so the version from the Mode update carries on.
  await api("POST", `/api/admin/models/${model.model.id}/backends`, {
    json: { backendId },
  });

  await waitReachable(backendId);
  await api("POST", `/api/admin/models/${model.model.id}/enable`, {
    json: { version },
  });
  console.log("seed: model with one Mode, attached to the backend, enabled");
}

async function seedUpload(): Promise<void> {
  const createRes = await api("POST", "/api/uploads", {
    json: {
      name: "seed-image.png",
      size: PNG_BYTES.length,
      type: "image/png",
    },
  });
  const upload = await asJson<{ upload: { id: string } }>(createRes);
  await api(
    "PUT",
    `/api/uploads/${upload.upload.id}/chunk?offset=0`,
    new Blob([PNG_BYTES], { type: "application/octet-stream" }),
  );
  await api("POST", `/api/uploads/${upload.upload.id}/complete`);
  console.log(
    "seed: one complete Upload (a real 1×1 PNG, ffprobed and thumbnailed)",
  );
}

async function main(): Promise<void> {
  await signIn(ADMIN_EMAIL);
  await seedSiteSettings();
  const backendId = await seedBackend();
  if (backendId) await seedModel(backendId);
  await seedUpload();
  console.log("seed: done");
}

await main();
