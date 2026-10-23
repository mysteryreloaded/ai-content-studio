import { Hono } from "hono";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

interface PendingCode {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
}

const CODE_TTL_MS = 5 * 60 * 1000;

function base64url(input: Uint8Array): string {
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString(
    "base64url",
  );
}

function challengeFromVerifier(verifier: string): string {
  const hash = new Bun.CryptoHasher("sha256").update(verifier).digest();
  return base64url(hash);
}

/**
 * An in-repo OpenID Connect issuer standing in for Google in dev and
 * tests. Only mounted when `OIDC_ISSUER` is set, which `env.ts` refuses
 * unless `PUBLIC_URL` is localhost. GET `/authorize` renders a tiny
 * picker so a developer can sign in as any email; it also accepts
 * `mock_email` etc. directly so tests can drive it without a browser.
 */
export async function createMockOidcIssuer(issuerUrl: string): Promise<Hono> {
  const app = new Hono();
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "mock-1",
    alg: "RS256",
    use: "sig",
  };
  const codes = new Map<string, PendingCode>();

  app.get("/.well-known/openid-configuration", (c) =>
    c.json({
      issuer: issuerUrl,
      authorization_endpoint: `${issuerUrl}/authorize`,
      token_endpoint: `${issuerUrl}/token`,
      jwks_uri: `${issuerUrl}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "email", "profile"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
      ],
    }),
  );

  app.get("/jwks", (c) => c.json({ keys: [jwk] }));

  app.get("/authorize", async (c) => {
    const q = c.req.query();
    const required = [
      "client_id",
      "redirect_uri",
      "state",
      "code_challenge",
      "nonce",
    ] as const;
    if (required.some((key) => !q[key])) {
      return c.text("missing required authorization parameters", 400);
    }
    const clientId = q.client_id as string;
    const redirectUri = q.redirect_uri as string;
    const state = q.state as string;
    const codeChallenge = q.code_challenge as string;
    const nonce = q.nonce as string;

    if (q.cancel === "1") {
      const redirect = new URL(redirectUri);
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("state", state);
      return c.redirect(redirect.toString());
    }

    if (q.mock_email) {
      const code = crypto.randomUUID();
      codes.set(code, {
        sub: q.mock_sub || `mock-${q.mock_email}`,
        email: q.mock_email,
        emailVerified: q.mock_email_verified !== "false",
        name: q.mock_name || q.mock_email,
        picture: q.mock_picture || null,
        nonce,
        codeChallenge,
        redirectUri,
        clientId,
        expiresAt: Date.now() + CODE_TTL_MS,
      });
      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", state);
      return c.redirect(redirect.toString());
    }

    const hidden = Object.entries(q)
      .map(
        ([key, value]) =>
          `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`,
      )
      .join("\n");

    return c.html(`<!doctype html>
<html>
<body style="font-family: sans-serif; max-width: 420px; margin: 4rem auto;">
<h1>Mock Google sign-in</h1>
<p>Dev/test-only stand-in for Google's consent screen.</p>
<form method="get">
${hidden}
<label>Email <input name="mock_email" value="dev@example.com" required></label><br><br>
<label>Name <input name="mock_name" value="Dev User"></label><br><br>
<label>Picture URL <input name="mock_picture" value=""></label><br><br>
<label><input type="checkbox" name="mock_email_verified" value="true" checked> Email verified</label><br><br>
<button type="submit">Continue</button>
</form>
<form method="get">
${hidden}
<input type="hidden" name="cancel" value="1">
<button type="submit">Cancel</button>
</form>
</body>
</html>`);
  });

  app.post("/token", async (c) => {
    const body = await c.req.parseBody();
    const code = String(body.code ?? "");
    const pending = codes.get(code);
    codes.delete(code);

    if (!pending || pending.expiresAt < Date.now()) {
      return c.json({ error: "invalid_grant" }, 400);
    }
    if (String(body.redirect_uri ?? "") !== pending.redirectUri) {
      return c.json({ error: "invalid_grant" }, 400);
    }
    const verifier = String(body.code_verifier ?? "");
    if (challengeFromVerifier(verifier) !== pending.codeChallenge) {
      return c.json({ error: "invalid_grant" }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({
      email: pending.email,
      email_verified: pending.emailVerified,
      name: pending.name,
      picture: pending.picture ?? undefined,
      nonce: pending.nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "mock-1" })
      .setSubject(pending.sub)
      .setIssuer(issuerUrl)
      .setAudience(pending.clientId)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);

    return c.json({
      access_token: "mock-access-token",
      token_type: "Bearer",
      expires_in: 300,
      id_token: idToken,
    });
  });

  return app;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
