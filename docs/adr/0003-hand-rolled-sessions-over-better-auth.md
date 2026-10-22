---
status: accepted
---

# Hand-rolled sessions instead of Better Auth

Sign-in is Google only, with two roles and a disabled status. We decided the studio owns its users and sessions tables, its session cookie and its middleware, about 200 lines in total. The Google code exchange goes through `oauth4webapi`, a maintained, zero-dependency OIDC client that handles PKCE, `state`, `nonce` and the ID-token checks. The studio therefore never copies the frozen Lucia/Arctic snippets.

The deciding reason is that every Audit entry is written in the same transaction as its change. On first sign-in, the callback creates the user, promotes them if `ADMIN_EMAILS` lists them, and writes the "system" Audit entry, all in one transaction. Disable, role changes and deletion go through studio routes for the same reason.

## Considered Options

- **Better Auth with its admin plugin.** Bun is tested in its CI, and it needs the least code. But its user-create hooks run outside the studio's transaction. Its `/api/auth/admin/*` endpoints (set role, ban, impersonate, set password, create user) would have to be turned off, which removes most of the reason to adopt it. It also adds its own `user`, `session`, `account` and `verification` schema next to the studio's, along with 16 dependencies and a fast release cadence that self-hosters must track. It stores session tokens unhashed and cannot use the `__Host-` cookie prefix.
- **Auth.js via `@hono/auth-js`.** It is in maintenance mode, has no role or ban model, and its maintainers point new projects to Better Auth.
- **`@hono/oauth-providers`.** It has no PKCE and no ID token, and its default `redirect_uri` breaks behind a TLS-terminating proxy.

## Consequences

- The studio owns the security of its session code: the token is stored as a SHA-256 of its secret, and the cookie is `__Host-session` (`HttpOnly; Secure; SameSite=Lax`). The app and its API must be served from one origin, and every non-GET request must pass a `Sec-Fetch-Site`/`Origin` check.
- Role and status are read with the session on every request, so a demotion, disable or delete takes effect at the next request.
- Tests sign in against a mock OIDC issuer set by an env override, so they exercise the production code path.
- If `oauth4webapi` misbehaves on Bun, the fallback is the 0BSD Lucia/Arctic snippets plus `jose`. Sessions are unaffected.
