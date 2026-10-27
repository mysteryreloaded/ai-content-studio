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
them — which is what they land on after the terms, instead of the
Studio itself.

## The site terms screen

`/terms` is readable without signing in, but the only action on the
page is offered to a signed-in user. When site terms are set, the page
shows the terms body — with a "Version N, effective …" line when the
version carries an effective date — and, for a signed-in user who
hasn't accepted the current version, a single **Accept** button. There is no "don't accept" option and no sign-out
on the page: a user who won't accept simply can't pass the gate,
because every active page sends them back to `/terms` until they do.
Accepting records it (`POST /api/terms/accept`, version and time) and
returns them to the page they were trying to reach. A signed-in user
who has already accepted the current version sees "You've accepted the
current version." instead of the button, and a Studio with no site
terms set just says "No Site terms have been set."

The terms screen is what a pending user sees first, before the waiting
page — see below.

## The Model terms dialog

The first time a user opens a Model whose terms body is non-blank, a
**blocking dialog** appears: a "**{Model}'s terms**" heading, the
terms body in Markdown, a **License** link when the Model has a
License URL, and a single **Accept** button — no checkbox, no
"continue", and no attribution line. It is genuinely blocking: there
is no **Close** button and the Escape key is ignored, so accepting is
the only way out. The user can open the same dialog again later from
the Workbench to view the terms; that one is dismissible with a
**Close** button.

- **Accepting** is `POST /api/models/:slug/terms/accept`, which records
  which version of that Model's terms the user accepted. A Model whose
  terms body is blank has no terms version to accept, and posting for
  it fails (400 `no_terms`); the same for a disabled Model (404).
- If a **Generate** is submitted while the user's acceptance of that
  Model's terms is no longer current, the server answers 409
  `model_terms_required`: nothing is queued, the Workbench refetches
  the Model, and the dialog reopens blocking with "Accept this
  Model's terms to continue."
- If you save a Model's terms with **"Ask everyone to accept again"**,
  a new version is recorded and every user's acceptance of the old
  version is cleared; the next time each of them opens the Model they
  get the dialog again.

## The privacy page

`/privacy` is always in the footer and always readable without
signing in. It informs; it never asks for anything and never blocks a
page. See [Privacy](privacy.md) for exactly what it says and why it
can't lie.

## What a signed-in user sees next

On the gated routes the terms gate is the outer one: a pending user
who hasn't accepted the current site terms is sent to `/terms` first,
and only after accepting do they reach the waiting page. Their status
then decides the rest:

- **Pending** (approval-mode Studios): the **Waiting page** —
  "Waiting for approval", a line that an Admin needs to approve the
  account, "Questions or reports:" with your contact address if
  you've set one, and a **Sign out** button. They can't generate until
  you approve them in the admin UI.
- **Active**: the normal Studio, with the terms flows above.
- **Disabled**: a disabled user is never given a session (disabling
  one also deletes its existing sessions), so a sign-in with that
  Google account ends on the landing page with the banner "This
  account has been disabled." and your contact address, if you've
  set one; signing in again fails the same way.
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
  → disabled?  → no session; "This account has been disabled." banner
  → blocked?   → no session; "This account can't sign in." banner
  → pending?   → site terms (if set and not accepted) → waiting page
  → active:
       → site terms (if set and not accepted at current version)
       → active pages
            → open a Model with terms?
                 → blocking dialog, until accepted
```
