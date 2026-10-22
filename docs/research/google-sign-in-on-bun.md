# Google sign-in and sessions on Bun + Hono

Research for ticket `07-google-sign-in-on-bun`. Gathered 2026-10-22 from primary sources: library source cloned from GitHub at the commits listed under Sources, plus Google, OWASP and maintainer pages. The npm registry could not be reached from the research shell, so versions come from each repo's `package.json`, CHANGELOG and git tags.

## Summary

- Four options are still maintained: **Better Auth** (1.7.12, released 2026-10-20), **hand-rolled OIDC plus sessions** built from the maintainer's public-domain-style snippets, **`@hono/oauth-providers`** (0.9.0) for the redirect flow combined with hand-rolled sessions, and **Auth.js through `@hono/auth-js`**. Auth.js now gets only security and urgent fixes, and its own maintainers point new projects to Better Auth.
- **Lucia, Arctic and most Oslo packages are deprecated.** Arctic and Oslo were deprecated in July 2026; Lucia in March 2025. What remains is 0BSD example code: a single-file session module and Google authorization and code-exchange snippets. "Arctic + Oslo" is therefore no longer a library option. It is the hand-rolled option with a reference implementation.
- **Bun:** Better Auth's CI runs a Bun smoke test. The hand-rolled snippets use only Web Crypto and `Uint8Array.toBase64/fromBase64/toHex`, which work on Bun 1.4.2 (checked locally). Hono's middleware is runtime-agnostic. Auth.js has no Bun job in CI.
- **Postgres sessions:** Better Auth keeps them in its own `session` table, through the Drizzle adapter or a `pg` Pool. In the hand-rolled option the studio owns the table; the Lucia snippet stores a SHA-256 hash of the secret, as OWASP recommends.
- **Role and disabled flag:** Better Auth's admin plugin adds `role`, `banned`, `banReason` and `banExpires`. Banning a user deletes all of their sessions, and with default settings every request re-reads the session from the database, so a disable takes effect on the next request. In the hand-rolled option these are two columns that the session middleware checks on every request.
- **Cookies and CSRF:** the simplest setup serves the SPA and API from one origin behind a reverse proxy, with a `HttpOnly; Secure; SameSite=Lax` host-only cookie plus a Fetch-Metadata/Origin check on non-GET requests (`hono/csrf`, or Lucia's `Sec-Fetch-Site` check). Separate subdomains work with credentialed CORS and an origin allowlist. Separate sites break in Safari.
- **Google:** `openid email profile` are non-sensitive scopes. Full app verification is not needed, and neither the unverified-app screen nor the 100-user cap applies. **Brand verification** is optional. Without it, the consent screen shows the domain instead of the app name and logo. To get it, the deployment needs a public homepage and a privacy policy on the same verified domain. Every self-hoster needs their own Google Cloud project and OAuth client, plus an HTTPS domain name. Raw IPs other than localhost are rejected.

## Option comparison

| | Better Auth + admin plugin | Hand-rolled (Lucia/Arctic snippets + `jose`) | `@hono/oauth-providers` + hand-rolled sessions | Auth.js via `@hono/auth-js` |
|---|---|---|---|---|
| Version (2026-10-22) | `better-auth` 1.7.12 (2026-10-20) | snippets at 2026-08-08 commits; `jose` v6.2.13 (optional) | 0.9.0 (2026-08-22) | `@hono/auth-js` 1.1.1 (2026-02-14), `@auth/core` 0.41.3 (2026-07-20) |
| Maintenance | Very active: 1.7.10, 1.7.11 and 1.7.12 shipped within 6 days | Project owns it; upstream packages deprecated | Active monorepo (honojs/middleware) | Security and urgent fixes only; `next-auth` v5 still beta.32 |
| Bun evidence | CI smoke test runs `Bun.serve` + `bun:sqlite` | Only Web APIs; verified on Bun 1.4.2 | Uses only `fetch` and `hono/cookie` | No Bun job in CI; "runtime-agnostic" claim only |
| Postgres sessions | Built in (`session` table; Drizzle adapter or `pg` Pool via Kysely) | Your table and queries (e.g. Drizzle) | Your table | `@auth/pg-adapter` / `@auth/drizzle-adapter` 1.11.3 |
| Token at rest | Raw token in `session.token`; cookie value HMAC-signed | SHA-256 hash of secret (OWASP-style) | Your choice | Adapter-defined (not checked) |
| Role / disabled | `role`, `banned`, `banExpires` built in; ban revokes sessions | Two columns, checked in your middleware | Same as hand-rolled | Custom columns + callbacks (no built-in ban) |
| CSRF on own routes | Origin + Fetch-Metadata checks on `/api/auth/*` only; app routes need `hono/csrf` | `Sec-Fetch-Site`/Origin check you add | `state` cookie only; app routes need `hono/csrf` | CSRF tokens on its own POST routes |
| OAuth hygiene | PKCE required for Google; `state`; ID-token checks | PKCE + `state` in snippets; you add `nonce` and ID-token validation | `state` only: **no PKCE, no ID token**; calls userinfo v2 | PKCE/state per Auth.js defaults (not re-checked) |
| Dependency weight | 16 direct deps + 18 optional peers | 0 deps (or `jose`) | 0 deps (peer `hono`) | `@auth/core` + adapter |
| Admin bootstrap | `databaseHooks.user.create.before` + env email allowlist (CLI `create-admin` needs a password) | Env allowlist check at sign-in | Same | Custom callback |

## Per-option detail

### 1. Better Auth (with the admin plugin)

**What it is.** A full auth framework, MIT licensed. Hono mounts it with `app.all("/api/auth/*", c => auth.handler(c.req.raw))` because both sides use Web `Request`/`Response`. The docs show a `createMiddleware` that calls `auth.api.getSession({ headers })` and stores the result in Hono context for other routes. [BA-hono]

**Bun.** The repo's E2E workflow installs Bun (`oven-sh/setup-bun` v2.2.0). It then runs `e2e/smoke/test/bun.spec.ts`, which starts `Bun.serve({ fetch: auth.handler })` against `bun:sqlite` and signs up a user. Better Auth also ships a `bun:sqlite` Kysely dialect and reads `Bun.env`. [BA-src: `.github/workflows/e2e.yml`, `e2e/smoke/test/bun.spec.ts`, `packages/core/src/env/env-impl.ts`]

**Postgres.** There are two routes: pass a `pg` `Pool`, which runs through Kysely's PostgresDialect, or use `@better-auth/drizzle-adapter` with `provider: "pg"`. The Drizzle adapter's peer range is `drizzle-orm ^0.45.2 || >=1.0.0-rc.1 <2`. Schema comes from `npx auth generate`, and Drizzle users then run `drizzle-kit generate/migrate`. Core tables are `user`, `session`, `account` and `verification`. [BA-pg] [BA-drizzle] [BA-db]

**Sessions.** Defaults are a 7-day `expiresIn` and a 1-day `updateAge` sliding refresh. `cookieCache` is off, so each `getSession` hits the database. If `cookieCache` is turned on, a revoked session can stay valid until the cache's `maxAge`. [BA-session] The session row stores the opaque token in a `token` column, and lookup is by that raw value (`internal-adapter.ts`). The cookie itself is HMAC-signed (`setSignedCookie`). [BA-src]

**Cookies.** The name is `better-auth.session_token`. When the cookie is secure, Better Auth prepends `__Secure-`; it does not use `__Host-`. Defaults are `HttpOnly`, `SameSite=Lax` and `Path=/`, and `Domain` is set only when `crossSubDomainCookies` is enabled. `Secure` follows the base URL protocol, or `NODE_ENV=production`, or `useSecureCookies`. [BA-cookies] [BA-src: `cookies/index.ts`, `cookie-utils.ts`]

**CSRF.** On its own routes Better Auth prefers non-simple requests (a JSON content type). It validates `Origin` against `trustedOrigins`, uses Fetch Metadata to block cross-site first-login navigations, and checks OAuth `state` and PKCE. [BA-security] These protections apply to `/api/auth/*` only. The studio's own Hono routes, such as starting a Generation or admin writes, need their own check. `hono/csrf` rejects unsafe methods with form-like content types unless `Sec-Fetch-Site` or `Origin` passes. JSON requests go through it and rely on CORS preflight. [Hono-csrf]

**SPA ↔ API topologies.**
- *Same origin* (`/api` reverse-proxied): no CORS needed. Set `BETTER_AUTH_URL` / `baseURL` to the public URL. Forwarded headers are ignored unless `advanced.trustedProxyHeaders: true`. [BA-google] [BA-options]
- *Sibling subdomains* (`app.` + `api.`): Hono `cors({ origin, credentials: true })` before the handler, the same origin in `trustedOrigins`, and the client using `credentials: "include"`. [BA-hono] `crossSubDomainCookies` is needed only when another subdomain must read the cookie. The docs warn that a broad `Domain` exposes the cookie to every subdomain. [BA-cookies]
- *Different sites*: the docs say Safari ITP blocks the cookies and recommend a reverse proxy or a shared parent domain. [BA-cookies]

**Google provider.** Default scopes are `email profile openid`, and `include_granted_scopes=true` is sent unless disabled. A `codeVerifier` (PKCE) is mandatory. The user profile comes from the ID token returned by the token endpoint, and `hd` is enforced from the token claim when it is configured. Accounts are keyed on `sub`. [BA-src: `packages/core/src/social-providers/google.ts`] The redirect URI to register is `https://<domain>/api/auth/callback/google`. [BA-google]

**Role and disabled flag.** The admin plugin adds `user.role` (default `user`), `banned`, `banReason` and `banExpires`, plus `session.impersonatedBy`. [BA-admin] In source:
- a `session.create.before` hook refuses new sessions for banned users and auto-clears an expired ban;
- `banUser` and admin-update-to-banned call `deleteUserSessions`, so existing sessions die. [BA-src: `plugins/admin/admin.ts`, `routes.ts`]

A per-request admin gate is therefore `session.user.role === "admin"` in the Hono middleware. The plugin also exposes list, create and remove user, set-role, set-password, session revoke and **impersonation**. Impersonation is on for the `admin` role by default, and admins cannot impersonate other admins unless granted `impersonate-admins`. [BA-admin] Without the plugin, `user.additionalFields` can add a `role` with `input: false` so clients cannot set it. [BA-db]

**Admin bootstrap.**
- (a) `adminUserIds` takes user IDs, which exist only after a first sign-in.
- (b) `npx auth create-admin --email …` exists, but it requires a password and creates a credential account (`packages/cli/src/commands/create-admin.ts`). That is awkward for a Google-only app.
- (c) A user `databaseHooks.user.create.before` can return `{ data: { role: "admin" } }` when the Google email is in an env allowlist. User hooks run after plugin hooks and their `data` merges over the plugin's default role (`context/helpers.ts`, `db/with-hooks.ts`). This applies only at creation; promoting users who already exist needs an update step. [BA-src] [BA-db]

**Weight and maintenance.**
- Direct deps: `@better-auth/core`, five adapter packages (which carry only optional peers), telemetry, `@better-auth/utils`, `@better-fetch/fetch`, `@noble/ciphers`, `@noble/hashes`, `better-call`, `defu`, `jose`, `kysely`, `nanostores` and `zod`. There are 18 optional peers. `better-auth/minimal` drops Kysely when another adapter is used. [BA-src: `package.json`] [BA-perf]
- Telemetry is opt-in (`BETTER_AUTH_TELEMETRY` defaults to false). [BA-telemetry]
- The GitHub advisories page lists 10 advisories between May and Aug 2026. They are mostly in the SSO, SCIM, oauth-provider and stripe plugins and the magic-link/OTP flows; none of the titles name social sign-in or the admin plugin. [BA-adv]
- Auth.js joined Better Auth in Sept 2025. [BA-authjs]

### 2. Hand-rolled OIDC + sessions (Lucia/Arctic reference code)

**Upstream status.** The Lucia repo README says the package was deprecated in March 2025 and points to `code/auth_session.ts` as a complete single-file replacement. The Arctic README and site say it was deprecated in July 2026 and point to `code/*.ts`. Both files are 0BSD. [Lucia-repo] [Arctic-repo] The maintainer's 2026-07-29 post deprecates Arctic and most Oslo packages; `@oslojs/encoding` stays until about 2028. The post narrows Lucia to the replacement guidance and closes the Discord by year end. [Pilcrow-18]

**What the reference code gives.**
- `auth_session.ts` (190 lines): the token is `id.secret`, with an 80-bit ID and a 32-byte secret. The database stores the SHA-256 of the secret, compared in constant time. Sessions last 10 days, sliding, with `tokenLastVerifiedAt` bumped at most hourly. The cookie is `Path=/; Secure; HttpOnly; SameSite=Lax`. The file carries a prominent note that cookie sessions **must** have CSRF protection and suggests rejecting non-GET/HEAD requests unless `Sec-Fetch-Site` is `same-origin`. [Lucia-repo]
- `authorization_request-pkce.ts` / `authorization_code_exchange-pkce.ts`: the Google endpoints, a PKCE S256 verifier kept in a short-lived `HttpOnly; Secure; SameSite=Lax` cookie, and a token POST with client credentials. The snippet omits `state`, which Google says to send and verify. [Arctic-repo] [G-web-server]
- These match OWASP's split of identifier and verifier with a hashed verifier, and its 128-bit-plus entropy guidance. [OWASP-session]

**What the studio would add.**
- `state` and `nonce`.
- ID-token validation: `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud` = client ID, `exp`, and the signature via the JWKS from discovery. Google says signature checking may be skipped when the token comes straight from the token endpoint over HTTPS with the client secret. [G-oidc]
- Using `sub` as the key (never email) and checking `email_verified`. [G-oidc]
- Session rotation at login, and server-side delete on logout. [OWASP-session]
- `jose` (v6.2.13; Better Auth also depends on it) would cover the JWT verification.

**Bun.** The code uses `crypto.getRandomValues`, `crypto.subtle.digest` and `Uint8Array.prototype.toBase64/toHex` plus `Uint8Array.fromBase64`. The snippets' comments only claim support on Node 25 and Deno. All of these ran on Bun 1.4.2 locally. Bun's latest tag is `bun-v1.4.3`.

**Postgres / role / disabled / bootstrap.** These are the studio's own tables, for example `users(id, google_sub UNIQUE, email, role, disabled_at)` and `auth_sessions(id, user_id, secret_hash, last_verified_at, created_at)`. Session validation joins the user row, so `disabled_at` and `role` are checked on every request at no extra cost. Disabling a user deletes their sessions. Bootstrap means checking the verified Google email against an `ADMIN_EMAILS` env list at sign-in.

**Weight.** Roughly 250–350 lines owned by the project, with zero deps or just `jose`. The project carries the security responsibility; there is no upstream to patch.

### 3. `@hono/oauth-providers` (Google) + hand-rolled sessions

- 0.9.0, released 2026-08-22, with only `hono >=3` as a peer. `googleAuth({ client_id, client_secret, scope })` handles the redirect and the callback, then sets `token`, `user-google` and `granted-scopes` on the context. Sessions are left to you. [Hono-op]
- In source (`src/providers/google/googleAuth.ts`, `authFlow.ts`):
  - a random `state` goes into a cookie named plainly `state` (`HttpOnly; Secure; SameSite=Lax`, 10 min) and is compared on callback;
  - **there is no PKCE and no `nonce`**;
  - the profile comes from `https://www.googleapis.com/oauth2/v2/userinfo` (field `verified_email`), not from an ID token;
  - `redirect_uri` defaults to `c.req.url`. Behind a TLS-terminating reverse proxy that URL may be `http://…`, which would cause `redirect_uri_mismatch`, so it should be set explicitly. This is an inference from the code, not tested.
- Sessions, role, disabled flag, CSRF and bootstrap work as in option 2. The library saves roughly the request and exchange snippets.
- **Related variant:** `@hono/oidc-auth` 1.10.0 (oauth4webapi) is OIDC with discovery. Its sessions are **stateless signed-JWT cookies** that re-check with the IdP every 15 minutes through a refresh token, so there is no Postgres session table and a disable takes effect late. It also notes that Google's `GOCSPX-` secrets need `setClientAuth(ClientSecretPost)`. [Hono-oidc]

### 4. Auth.js via `@hono/auth-js`

- `@hono/auth-js` 1.1.1 (last release 2026-02-14) has `@auth/core >=0.35` as a peer. `initAuthConfig`, `authHandler()` on `/api/auth/*` and `verifyAuth()` set `authUser`. [Hono-authjs]
- `@auth/core` is at 0.41.3 (2026-07-20). `next-auth` is still `5.0.0-beta.32`. The README says Auth.js is now part of Better Auth and recommends Better Auth for new projects. [AuthJS-repo] The Sept 2025 discussion promises security and urgent fixes only, with no v5 date. [AuthJS-13252]
- Postgres goes through `@auth/pg-adapter` or `@auth/drizzle-adapter` 1.11.3. The README says Auth.js uses CSRF tokens on its own POST routes. [AuthJS-repo]
- Role and disabled need custom adapter columns plus callbacks; nothing like the admin plugin exists. The callback details were not re-verified in this pass.
- No Bun job exists in the repo's workflows.

## Google requirements for a sign-in-only app

**Who registers what.**
- Redirect URIs must be registered exactly, matching scheme, case and trailing slash. [G-web-server]
- All domains for the homepage, privacy policy, terms, redirect URIs and JS origins must be owned and verified by the developer, for example through Search Console. [G-policy]
- So in practice **each self-hosted deployment creates its own Google Cloud project and Web-application OAuth client** and supplies the client ID and secret as env. One client run by the project maintainers could not cover arbitrary self-hosters' domains.
- Google recommends separate projects for test and production. Production clients should not list developer-only URIs. [G-policy]

**Redirect URI rules.** [G-web-server] [G-clients]
- HTTPS only, with localhost exempt.
- No raw IP hosts except localhost, so a LAN `http://192.168.x.x` deployment cannot sign in.
- The TLD must be on the public suffix list, and the host cannot be `googleusercontent.com`.
- No wildcards, fragments, userinfo, path traversal or open redirects.
- URL-shortener domains are only allowed if owned.
- Changes take about 5 minutes to a few hours to apply.

**Client housekeeping.** [G-clients]
- The client secret is shown in full only once, at creation, and is stored hashed.
- Clients unused for 6 months are deleted automatically, after an email warning 30 days before; they can be restored within 30 days. Any token request counts as use.

**Scopes.** [G-oidc]
- `openid` must come first; `openid email` is the basic request.
- `email` adds `email` and `email_verified`. `profile` adds name and picture, which are not guaranteed.
- Use `sub` as the stable ID. `hd` is only an account-picker hint unless the claim is checked.

**Verification levels.**
- *App verification* (full review) is not required for apps that use only non-sensitive scopes. [G-verif-hub]
- The **unverified-app warning and the 100-new-user lifetime cap** apply only to unverified sensitive or restricted scopes. [G-audience]
- In **Testing** status, an app that requests only `openid` / `userinfo.email` / `userinfo.profile` is exempt from the test-user list. Users see no warning and authorizations do not expire after 7 days. [G-audience]
- *Brand verification* is a lighter, optional process for basic-scope apps. It is needed for an External, In-production app that wants its **name and logo** on the consent screen. Without it, users see only the app's domain. [G-brand] [G-branding-help]
- Brand verification is not needed for personal use, Testing-status projects, internal Workspace apps, or service-account-only use. [G-brand]

**What brand verification requires.** [G-brand] [G-verif-req] [G-branding-help]
- App name (must not resemble Google or other brands), a logo (≤1 MB, square 120×120 recommended), a support email, and developer contacts.
- **Homepage:** public, not behind login, not only a login page. It must describe the app and link to the privacy policy at the **same URL** given on the consent screen.
- **Privacy policy:** on the **same domain as the homepage**. It must say how the app accesses, uses, stores and shares Google user data.
- Terms-of-service link: the pages disagree on whether it is required (see Open).
- Authorized domains: the top private domain of each of those URIs and of the redirect URIs, verified in Search Console by a project owner or editor.
- The sign-in button must follow the Sign in with Google branding guidelines (SDK or pre-approved assets; custom buttons only with the exact logo, font and padding rules). Compliance is required for verification. [G-button]
- Review timing: the automated check usually takes minutes; a manual review takes about 2–3 business days.
- Changing the name, logo, homepage, privacy URL or authorized domains creates a draft that must be re-verified. Passing results expire if not published within 7 days.

## Options & implications for the studio

Trade-offs only. The choice belongs to whoever closes the sign-in decision.

- **Better Auth** gets Google sign-in, Postgres sessions, role, disable (ban) and a user-admin API in the least project code. Its Bun support is CI-tested.
  - Costs: a large surface the studio did not write (the admin plugin's impersonation, set-password and create-user endpoints are live under `/api/auth/admin/*` unless restricted through custom access control), its own schema and ID conventions alongside the studio's Drizzle schema, and a fast release cadence with a 2026 advisory history that self-hosters must track.
  - Admin writes made through its endpoints bypass the studio's own code, so **Audit entries** would need its hooks or wrappers.
  - Its session token is stored unhashed.
- **Hand-rolled** gives the smallest dependency footprint and full control of the user and session schema. The disabled and role check folds into the session query, and the code is short and auditable, which fits "minimal and maintainable".
  - Cost: the project owns the correctness of `state`, PKCE, `nonce`, ID-token checks, rotation and CSRF, with no upstream security patches. The reference code it would start from belongs to deprecated packages and is frozen.
- **`@hono/oauth-providers` + hand-rolled sessions** trims the OAuth exchange code and stays inside the Hono ecosystem.
  - Cost: no PKCE, no ID token, and a `redirect_uri` default that is fragile behind a proxy. The savings over option 2 are small.
- **Auth.js** is in maintenance mode, is still pre-1.0 on core, has no role or ban model, and its own maintainers steer new projects away from it.
- **Deployment topology.** Same-origin behind the proxy is the simplest in every option: no CORS, a host-only cookie, and `Sec-Fetch-Site: same-origin`. Sibling subdomains add credentialed CORS and an origin allowlist; the default `hono/csrf` check would need `same-site` or an explicit origin. OWASP warns that sibling subdomains count as same-site, so a taken-over subdomain could forge requests; it recommends explicit origins, not subdomain patterns, and avoiding a broad cookie `Domain`. [OWASP-csrf] Separate sites are effectively unsupported because of Safari ITP.
- **Self-hoster requirements.** Every self-hoster needs a domain with HTTPS, their own Google Cloud project and client, and env for the public base URL. To show their brand on the consent screen they also need the public landing page and privacy policy on that same verified domain.

## Open / unconfirmed

- Whether Google's policy accepts a public, basic-scope app left in **Testing** status indefinitely. The audience page exempts it from the limits, but the brand page describes Testing as for dev and staging.
- Whether a **terms-of-service** URL is mandatory for brand verification. One help page lists the homepage, privacy and terms links as required for external production apps; the brand page calls terms optional on the homepage.
- That the unverified consent screen shows the *authorized domain* rather than the redirect host. The Google help page says "domain" without saying which; only a community thread (2026-08-06, not staff) describes the behaviour.
- Better Auth: whether the cookie can be configured to the `__Host-` prefix that OWASP recommends, given that the code adds `__Secure-` automatically. Also whether it runs on Bun's built-in SQL client through Drizzle's `bun-sql` driver; only `pg`, Postgres.js via Kysely, and Drizzle in general are documented.
- Install size of each option was not measured because the npm registry was unreachable. Dependency counts come from the manifests.
- Better Auth advisories before May 2026 (four more pages) were not reviewed.
- Auth.js role, ban and callback details, and its Bun behaviour, were not verified beyond the README and CI listing.
- Bun's `Uint8Array.fromBase64` and `toBase64` were confirmed on Bun 1.4.2 only; 1.4.3 was not run.

## Sources

Repos (cloned 2026-10-22, read only):
- [BA-src] github.com/better-auth/better-auth @ `c6a08cf` (2026-10-22). Docs under `docs/content/docs/`: [BA-hono] `integrations/hono.mdx`, [BA-cookies] `concepts/cookies.mdx`, [BA-session] `concepts/session-management.mdx`, [BA-db] `concepts/database.mdx`, [BA-pg] `adapters/postgresql.mdx`, [BA-drizzle] `adapters/drizzle.mdx`, [BA-google] `authentication/google.mdx`, [BA-admin] `plugins/admin.mdx`, [BA-security] `reference/security.mdx`, [BA-options] `reference/options.mdx`, [BA-telemetry] `reference/telemetry.mdx`, [BA-perf] `guides/optimizing-for-performance.mdx`. Also published at better-auth.com/docs.
- [Lucia-repo] github.com/lucia-auth/lucia @ `e1ef2bc` (2026-08-08): `README`, `code/auth_session.ts`, `lucia-auth.com/index.html`.
- [Arctic-repo] github.com/pilcrowonpaper/arctic @ `5bdc18b` (2026-08-08): `README`, `code/*.ts`, `arcticjs.dev/index.html` (the arcticjs.dev page source).
- [Hono-op] [Hono-oidc] [Hono-authjs] github.com/honojs/middleware @ `6433ae3` (2026-10-21): `packages/oauth-providers`, `packages/oidc-auth`, `packages/auth-js`, `packages/session` (README, CHANGELOG, src).
- [Hono-csrf] github.com/honojs/website @ `7838d77` (`docs/middleware/builtin/csrf.md`, `docs/helpers/cookie.md`) and github.com/honojs/hono 4.13.13 `src/middleware/csrf/index.ts`.
- [AuthJS-repo] github.com/nextauthjs/next-auth @ `a1a16a5` (2026-07-22): `README.md`, package manifests, `.github/workflows`.
- Tags via `git ls-remote`: oven-sh/bun `bun-v1.4.3`, panva/jose `v6.2.13`, panva/oauth4webapi `v3.8.8`.

Web (fetched 2026-10-22):
- [Pilcrow-18] https://pilcrowonpaper.com/blog/18 (2026-07-29)
- [BA-authjs] https://better-auth.com/blog/authjs-joins-better-auth (2025-09-22)
- [AuthJS-13252] https://github.com/nextauthjs/next-auth/discussions/13252 (2025-09-26)
- [BA-adv] https://github.com/better-auth/better-auth/security/advisories
- [G-web-server] https://developers.google.com/identity/protocols/oauth2/web-server
- [G-oidc] https://developers.google.com/identity/openid-connect/openid-connect (updated 2026-06-15)
- [G-brand] https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification (updated 2026-08-19)
- [G-policy] https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance (updated 2026-08-19)
- [G-button] https://developers.google.com/identity/branding-guidelines (updated 2026-07-07)
- [G-audience] https://support.google.com/cloud/answer/15549945 (Manage App Audience)
- [G-clients] https://support.google.com/cloud/answer/15549257 (Manage OAuth Clients)
- [G-branding-help] https://support.google.com/cloud/answer/10311615 (OAuth consent screen branding)
- [G-verif-req] https://support.google.com/cloud/answer/13464321 (Verification requirements)
- [G-verif-hub] https://support.google.com/cloud/answer/13463073 (OAuth App Verification help center)
- Community, non-authoritative: https://discuss.google.dev/t/brand-verification-the-consent-screen-shows-our-domain-not-the-configured-app-name-is-that-the-string-compared-against-the-home-page/388051 (2026-08-06)
- [OWASP-csrf] https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- [OWASP-session] https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
