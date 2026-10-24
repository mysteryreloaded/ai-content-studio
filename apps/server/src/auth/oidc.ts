import * as oauth from "oauth4webapi";

const GOOGLE_ISSUER = "https://accounts.google.com";

export interface OidcDeps {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

/** Non-HTTPS issuers (the mock issuer) are only ever localhost; see env.ts's refusal rule. */
function insecureOption(issuer: string): {
  [oauth.allowInsecureRequests]?: true;
} {
  return issuer.startsWith("https://")
    ? {}
    : { [oauth.allowInsecureRequests]: true };
}

const discoveryCache = new Map<
  string,
  Promise<{ as: oauth.AuthorizationServer; client: oauth.Client }>
>();

/** Discovery is cached per issuer for the process lifetime: it never changes at runtime. */
function discover(
  deps: OidcDeps,
): Promise<{ as: oauth.AuthorizationServer; client: oauth.Client }> {
  const cached = discoveryCache.get(deps.issuer);
  if (cached) return cached;

  const promise = (async () => {
    const issuerUrl = new URL(deps.issuer);
    const response = await oauth.discoveryRequest(
      issuerUrl,
      insecureOption(deps.issuer),
    );
    const as = await oauth.processDiscoveryResponse(issuerUrl, response);
    const client: oauth.Client = { client_id: deps.clientId };
    return { as, client };
  })();

  discoveryCache.set(deps.issuer, promise);
  return promise;
}

export function resolveIssuer(oidcIssuerOverride: string | undefined): string {
  return oidcIssuerOverride ?? GOOGLE_ISSUER;
}

/** Builds the Google (or mock) authorization URL for a fresh sign-in attempt. */
export async function buildAuthorizationRequest(
  deps: OidcDeps,
  returnTo: string,
): Promise<AuthorizationRequest> {
  const { as, client } = await discover(deps);

  const state = oauth.generateRandomState();
  const nonce = oauth.generateRandomNonce();
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);

  if (!as.authorization_endpoint) {
    throw new Error("issuer metadata is missing authorization_endpoint");
  }
  const url = new URL(as.authorization_endpoint);
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", deps.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (returnTo) url.searchParams.set("return_to_hint", returnTo);

  return { url: url.toString(), state, nonce, codeVerifier };
}

export type CallbackResult =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; reason: "cancelled" | "failed" | "unverified" };

/**
 * Exchanges the callback's `code` for Google's ID token, verifying PKCE,
 * `state`, `nonce` and the token's signature/claims (ADR 0003). Google's
 * tokens are discarded immediately after; only the verified identity is
 * returned.
 */
export async function handleCallback(
  deps: OidcDeps,
  callbackUrl: URL,
  expectedState: string,
  expectedNonce: string,
  codeVerifier: string,
): Promise<CallbackResult> {
  if (callbackUrl.searchParams.get("error")) {
    return { ok: false, reason: "cancelled" };
  }

  try {
    const { as, client } = await discover(deps);
    const clientAuth = oauth.ClientSecretBasic(deps.clientSecret);

    const params = oauth.validateAuthResponse(
      as,
      client,
      callbackUrl.searchParams,
      expectedState,
    );

    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      clientAuth,
      params,
      deps.redirectUri,
      codeVerifier,
      insecureOption(deps.issuer),
    );

    const result = await oauth.processAuthorizationCodeResponse(
      as,
      client,
      response,
      {
        expectedNonce,
        requireIdToken: true,
        ...insecureOption(deps.issuer),
      },
    );

    const claims = oauth.getValidatedIdTokenClaims(result);
    if (!claims) return { ok: false, reason: "failed" };

    const emailVerified = claims.email_verified === true;
    if (!emailVerified) return { ok: false, reason: "unverified" };

    return {
      ok: true,
      identity: {
        sub: String(claims.sub),
        email: String(claims.email ?? ""),
        emailVerified,
        name:
          typeof claims.name === "string"
            ? claims.name
            : String(claims.email ?? ""),
        picture: typeof claims.picture === "string" ? claims.picture : null,
      },
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
