// The per-identity API client and headless sign-in for the shots tool
// (issue #187). Mirrors `scripts/seed.ts`'s `signIn`/`api`/`absorbCookies`,
// but gives each identity its own cookie jar instead of one module-level
// jar, so several identities can be signed in at once.

export interface Client {
  readonly email: string;
  api(
    method: string,
    path: string,
    body?: RequestInit["body"] | { json: unknown } | { form: FormData },
  ): Promise<Response>;
  json<T>(
    method: string,
    path: string,
    body?: RequestInit["body"] | { json: unknown } | { form: FormData },
  ): Promise<T>;
  cookieHeader(): string;
}

function fail(step: string, res: Response, body: string): never {
  throw new Error(
    `shots: ${step} failed: HTTP ${res.status} ${res.statusText}\n${body.slice(0, 2000)}`,
  );
}

function makeJar(): {
  jar: Record<string, string>;
  absorb(res: Response): void;
  header(): string;
} {
  const jar: Record<string, string> = {};
  return {
    jar,
    absorb(res: Response) {
      for (const line of res.headers.getSetCookie()) {
        const first = line.split(";")[0] ?? "";
        const eq = first.indexOf("=");
        if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1);
      }
    },
    header() {
      return Object.entries(jar)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
  };
}

/** Signs in as `email` through the mock issuer's three-hop redirect chain, using its own jar. */
async function signIn(
  origin: string,
  jar: ReturnType<typeof makeJar>,
  email: string,
  name: string,
): Promise<void> {
  const first = await fetch(new URL("/api/auth/google", origin), {
    redirect: "manual",
  });
  const firstLocation = first.headers.get("location");
  if (first.status !== 302 || !firstLocation) {
    fail("sign in", first, await first.text().catch(() => ""));
  }
  jar.absorb(first);

  const authorize = new URL(firstLocation);
  authorize.searchParams.set("mock_email", email);
  authorize.searchParams.set("mock_name", name);
  authorize.searchParams.set("mock_email_verified", "true");

  const second = await fetch(authorize, {
    redirect: "manual",
    headers: { Cookie: jar.header() },
  });
  const secondLocation = second.headers.get("location");
  if (second.status !== 302 || !secondLocation) {
    fail("sign in (mock issuer)", second, await second.text().catch(() => ""));
  }
  jar.absorb(second);

  const callback = await fetch(new URL(secondLocation), {
    redirect: "manual",
    headers: { Cookie: jar.header() },
  });
  if (callback.status !== 302) {
    fail("sign in (callback)", callback, await callback.text().catch(() => ""));
  }
  jar.absorb(callback);

  if (!jar.jar["__Host-session"]) {
    throw new Error(`shots: sign-in as ${email} set no session cookie`);
  }
}

/** Signs in as `email` and returns a client that carries this identity's cookies on every request. */
export async function createClient(
  base: string,
  email: string,
  name: string,
): Promise<Client> {
  const origin = new URL(base).origin;
  const jar = makeJar();
  await signIn(origin, jar, email, name);
  return buildClient(origin, email, jar);
}

/** A client over an already-signed-in jar's cookie header (issue #187: a disabled user signs in through the API too, even once the browser flow records "disabled"). */
export function clientFromCookies(
  base: string,
  email: string,
  cookieHeader: string,
): Client {
  const origin = new URL(base).origin;
  const jar = makeJar();
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq > 0) jar.jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return buildClient(origin, email, jar);
}

function buildClient(
  origin: string,
  email: string,
  jar: ReturnType<typeof makeJar>,
): Client {
  async function api(
    method: string,
    path: string,
    body?: RequestInit["body"] | { json: unknown } | { form: FormData },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Origin: origin,
      Cookie: jar.header(),
    };
    let payload: RequestInit["body"];
    if (
      typeof body === "string" ||
      body instanceof Blob ||
      body instanceof FormData ||
      body instanceof URLSearchParams ||
      ArrayBuffer.isView(body)
    ) {
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
    jar.absorb(res);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      fail(`${method} ${path}`, res, text);
    }
    return res;
  }

  return {
    email,
    api,
    async json<T>(
      method: string,
      path: string,
      body?: RequestInit["body"] | { json: unknown } | { form: FormData },
    ): Promise<T> {
      return (await api(method, path, body)).json() as Promise<T>;
    },
    cookieHeader() {
      return jar.header();
    },
  };
}
