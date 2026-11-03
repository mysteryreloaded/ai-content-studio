// One API client per identity (issue #187). The studio is a same-origin
// app: every non-GET/HEAD request must carry `Origin: <base>`, and the
// session rides a plain cookie, so each client keeps a hand-rolled
// cookie jar. `scripts/seed.ts` does the same for one Admin; the shots
// seed walks several identities, so the jar lives on the client, not
// at module level. The one studio `fetch` that needs no session or
// origin is the boot `GET /healthz` (see {@link waitHealthy}).

/** An identity: the display name and email the mock issuer signs in as. */
export interface Identity {
  name: string;
  email: string;
}

export class Client {
  /** Cookie name → value, kept by hand, as in seed.ts. */
  readonly jar: Record<string, string> = {};

  constructor(
    private readonly base: string,
    private identity: Identity | null = null,
  ) {}

  get id(): Identity | null {
    return this.identity;
  }

  /** The jar as `{name, value}` pairs, for the browser fallback (shots.ts). */
  cookies(): Array<{ name: string; value: string }> {
    return Object.entries(this.jar).map(([name, value]) => ({
      name,
      value,
    }));
  }

  /**
   * Signs in through the mock issuer's two-hop redirect chain, exactly
   * as seed.ts: `GET /api/auth/google` 302s to the issuer's `/authorize`
   * with flow cookies; the mock query params skip the picker form and
   * 302 to the callback, which sets `__Host-session` and 302s to
   * `return_to`.
   */
  async signIn(name: string, email: string): Promise<void> {
    this.identity = { name, email };
    const first = await fetch(new URL("/api/auth/google", this.base), {
      redirect: "manual",
    });
    const firstLocation = first.headers.get("location");
    if (first.status !== 302 || !firstLocation) {
      this.fail("sign in", first);
    }
    this.absorb(first);

    const authorize = new URL(firstLocation);
    authorize.searchParams.set("mock_email", email);
    authorize.searchParams.set("mock_name", name);
    authorize.searchParams.set("mock_email_verified", "true");

    const second = await fetch(authorize, {
      redirect: "manual",
      headers: { Cookie: this.cookieHeader() },
    });
    const secondLocation = second.headers.get("location");
    if (second.status !== 302 || !secondLocation) {
      this.fail("sign in (mock issuer)", second);
    }
    this.absorb(second);

    const callback = await fetch(new URL(secondLocation), {
      redirect: "manual",
      headers: { Cookie: this.cookieHeader() },
    });
    if (callback.status !== 302) {
      this.fail("sign in (callback)", callback);
    }
    this.absorb(callback);

    if (this.jar["__Host-session"] === undefined) {
      throw new Error(`shots: the sign-in callback for ${email} set no __Host-session cookie`);
    }
  }

  /**
   * One studio request. Raw bodies (string, Blob, FormData,
   * URLSearchParams, typed arrays) pass through untouched; `{json}`
   * stringifies; `{form}` sends the FormData. A non-2xx throws with the
   * body, so a seed step that surprises the API never writes half a
   * studio.
   */
  async api(
    method: string,
    path: string,
    body?:
      | RequestInit["body"]
      | { json: unknown }
      | { form: FormData },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      // The same-origin guard: every non-GET/HEAD request must carry it.
      Origin: this.base,
      Cookie: this.cookieHeader(),
    };
    let payload: RequestInit["body"];
    // Raw bodies first: Bun's Blob carries a `json()` method on its
    // prototype, so the `"json" in body` wrapper check below would see a
    // Blob and stringify `undefined` instead of the bytes (same note as
    // seed.ts).
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
    const res = await fetch(new URL(path, this.base), {
      method,
      headers,
      body: payload,
      redirect: "manual",
    });
    if (!res.ok) {
      this.fail(path, res);
    }
    return res;
  }

  async getJson<T>(path: string): Promise<T> {
    return (await (await this.api("GET", path)).json()) as T;
  }

  async postJson<T>(path: string, body?: unknown): Promise<T> {
    return (await (
      await this.api("POST", path, body === undefined ? undefined : { json: body })
    ).json()) as T;
  }

  async putJson<T>(path: string, body?: unknown): Promise<T> {
    return (await (
      await this.api("PUT", path, body === undefined ? undefined : { json: body })
    ).json()) as T;
  }

  /**
   * One Upload, the same three calls the web app makes: create
   * (`POST /api/uploads`), the octet-stream chunk
   * (`PUT /:id/chunk?offset=0`), complete (`POST /:id/complete`).
   * Returns the Upload id; the prompt value for a bound upload Input is
   * that id, and the runner re-uploads the file to the Backend under
   * `studio/<id>.<ext>` itself.
   */
  async upload(
    name: string,
    type: string,
    bytes: Uint8Array,
  ): Promise<string> {
    const created = await this.postJson<{ upload: { id: string } }>(
      "/api/uploads",
      { name, size: bytes.length, type },
    );
    await this.api(
      "PUT",
      `/api/uploads/${created.upload.id}/chunk?offset=0`,
      new Blob([bytes]),
    );
    await this.api("POST", `/api/uploads/${created.upload.id}/complete`);
    return created.upload.id;
  }

  private absorb(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const first = line.split(";")[0] ?? "";
      const eq = first.indexOf("=");
      if (eq > 0)
        this.jar[first.slice(0, eq).trim()] = first.slice(eq + 1);
    }
  }

  private cookieHeader(): string {
    return Object.entries(this.jar)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private async fail(what: string, res: Response): Promise<never> {
    const text = await res.text().catch(() => "");
    throw new Error(
      `shots: ${what} answered ${res.status} ${res.statusText}` +
        (text === "" ? "" : `: ${text.slice(0, 500)}`),
    );
  }

  /**
   * Polls `GET /healthz` until it answers 200. This is the one studio
   * `fetch` that needs no origin and no cookie: it is the boot
   * liveness check, not a session request.
   */
  static async waitHealthy(base: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await fetch(new URL("/healthz", base), {
        cache: "no-store",
      }).catch(() => null);
      if (res !== null && res.status === 200) return;
      if (Date.now() > deadline) {
        throw new Error(
          `shots: ${base}/healthz never answered 200 within ${timeoutMs} ms`,
        );
      }
      await Bun.sleep(250);
    }
  }
}
