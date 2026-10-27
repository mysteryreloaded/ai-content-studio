# The consent screen

The Studio has three consent surfaces, and they stack in this order:

1. **Site terms** — once, for the whole Studio, before the active pages
   (see [Site terms](site-terms.md) for the Operator side).
2. **Model terms** — per Model, the first time a user opens that Model,
   and again whenever you ask.
3. **The privacy page** — informative only; it never gates anything.

A user who hasn't accepted the current site terms is asked for it
before they can use the Studio; on top of that, a user who opens a
Model with terms is asked for those too. And underneath all of it, a
new user in an approval-mode Studio is *pending* until you approve
them — which changes what they can see before any terms come up.

## The site terms screen

At `/terms`, a signed-in user who hasn't accepted the current version
sees the body with two choices:

- **Accept** — records the acceptance
  (`POST /api/terms/accept`, version and time) and sends them to the
  page they were trying to reach.
- **Don't accept** — signs them out. The Studio keeps no
  "rejected" state: a user who won't accept simply can't stay signed
  in on a gated Studio.

The terms screen is what a pending user sees first, before the waiting
page — see below.

## The Model terms dialog

The first time a user opens a Model whose terms body is non-blank, a
**blocking dialog** appears: the terms body, the Model's license link
and attribution line, an **I accept** checkbox and a **Continue**
button. It is genuinely blocking — no close button, the Escape key
does nothing — until the checkbox is ticked.

- **Continue without accepting** fails: the server answers 409
  `model_terms_required`, nothing is queued, and the dialog reopens,
  still blocking.
- **Accepting** is `POST /api/models/:slug/terms/accept`, which records
  which version of that Model's terms the user accepted. A Model whose
  terms body is blank has no terms version to accept, and posting for
  it fails (400 `no_terms`); the same for a disabled Model (404).
- If you save a Model's terms with **"Ask everyone to accept again"**,
  a new version is recorded and every user's acceptance of the old
  version is cleared; the next time each of them opens the Model they
  get the dialog again.

## The privacy page

`/privacy` is always in the footer and always readable without
signing in. It informs; it never asks for anything and never blocks a
page. See [Privacy](privacy.md) for exactly what it says and why it
can't lie.

## What a new user sees before any terms

User status decides what a signed-in user can do at all, and it is
checked *before* terms on the gated routes — so a pending user who
hasn't accepted the site terms sees the terms screen first, and the
waiting page second:

- **Pending** (approval-mode Studios): the **Waiting page** — "Waiting
  for approval", your contact address if you've set one, and a note
  that **no email is sent** while they wait. They can't generate until
  you approve them in the admin UI.
- **Active**: the normal Studio, with the terms flows above.
- **Disabled**: signing in with that Google account no longer works
  (their sessions are deleted when you disable them), and if they try,
  the landing page shows a banner — "This account has been disabled." —
  with your contact address; the only action left is signing out.
- **Blocked**: a Google account that was *deleted* while disabled can't
  sign back in at all; the landing banner says "This account can't
  sign in." instead.

Sign-ins that don't land on an active user fail with one of the
`auth_error` values `cancelled` (the user closed the Google window),
`failed`, `unverified` (the Google account's email isn't verified —
the Studio refuses it), `disabled`, or `blocked`; the landing page
shows the matching banner.

## The order, summarized

```
sign in (Google)
  → disabled?  → disabled banner, sign out only
  → blocked?   → "can't sign in" banner, sign out only
  → pending?   → site terms (if set) → waiting page
  → active:
       → site terms (if set and not accepted at current version)
       → active pages
            → open a Model with terms?
                 → blocking dialog, until accepted
```
