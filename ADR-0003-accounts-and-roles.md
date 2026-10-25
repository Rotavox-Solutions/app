# ADR-0003 — Accounts, Station Roles and Rotavox Staff

- **Status:** Accepted 2026-10-25
- **Date:** 2026-10-25
- **Context:** Step 1 of moving the web app to the cloud (app.rotavox.com), with the
  Runner staying on the broadcast box and reaching the cloud by API. Until now the web
  app had no sign-in and served one station named by an env var. It was safe only
  because it listened on the box's loopback interface.
- **Builds on:** `CLAUDE.md` invariant #3 (station_id on every table), ADR-0002 (the UI
  is the source of truth, so who changed what now matters).

---

## 1. Decision

Every page and API route requires a signed-in person. What they may do is set by their
role at the station they are working on. The station comes from the session, never from
the request or the environment.

| Role | Who | May |
|---|---|---|
| Viewer | anyone who needs to look | view everything |
| Programmer | PD, MD | + music changes, logs, ask the Runner to sync |
| Station admin | the station's manager | + people, station setup (pool import) |
| Rotavox staff | us | all of the above at every station, + staff tools |

The table lives in one place, `can()` in `packages/schema/src/accounts.ts`. The server
checks it on every request. The UI hides controls a person can't use, but it is not the
enforcement.

## 2. Shape

- **`users`** is a person, one account across every station they work for. It is the
  one table without a `station_id`, a deliberate exception to invariant #3: an account
  can't belong to one station. Everything a person can do at a station lives in
  **`station_members`** `(station_id, user_id, role)`, which has one. Staff is
  `users.is_staff`: staff aren't members of anything and can open every station.
- **`sessions`** hold the SHA-256 of a random cookie token, never the token, plus the
  station that browser is working on. 30 days, then sign in again. A membership
  removed mid-session takes effect on that person's next request.
- **`account_tokens`** are one-time links: invitations (to a station with a role, or to
  staff) and password resets. They are hashed like sessions, expire (7 days and 24
  hours), and work once. Inviting the same email again replaces the old link.
- **Passwords** are scrypt (N=2^15, r=8, p=1), self-describing so the cost can be
  raised later, with at least 12 characters. Ten wrong passwords lock the account for
  15 minutes. An unknown email takes as long to refuse as a wrong password.
- **Attribution:** `changesets.applied_by` and `runner_jobs.requested_by_user`. The
  Changes history shows who applied each change.

## 3. Choices and why

- **Our own implementation, not an auth library.** It is about 600 lines on
  `node:crypto` with no new dependencies, and it lives in `@rotavox/schema`, so the
  web app, the engineer bootstrap and the coming Runner API share it. A hosted identity
  provider, or SSO for station groups, can be added later as another way to start a
  session. The session and role model doesn't change.
- **Invitation links, not email.** Rotavox sends no email yet. An admin copies the
  link and sends it however they like. It is shown once. When email arrives, the same
  tokens get mailed.
- **Someone who already has an account proves it to accept an invitation.** A
  forwarded link can't attach a stranger to an existing account.
- **Only staff make reset links.** A reset opens the account at every station the
  person works for, which is more than one station's admin should be able to do.
- **A station always keeps a station admin.** Otherwise nobody there could manage its
  people.
- **CSRF:** `SameSite=Lax` cookies, plus an Origin check on every state-changing route.
  The check also catches a forged sign-in that carries no cookie.
- **Station scoping is in the data layer, not only the route.** Functions that took a
  log id alone now take the station too, and treat another station's id as not found.
  A test fails if any API route is exported without one of the three guards.

## 4. Bootstrapping

The first staff account is the one thing the UI can't create. An engineer runs
`npm run invite-staff -w @rotavox/schema -- <email>` on the server. It prints a
one-time link, so no password is typed on a command line. Everyone else is invited in
the app (DEPLOY.md step 12).

## 5. Not yet

- Creating a station from the staff page. It is still the SQL in DEPLOY.md step 4.
- Disabling an account from the UI. The column exists.
- Email: invitations, resets, notices.
- Runner credentials. The Runner still reads Postgres directly. Step 2 gives each
  station's Runner its own token for the API, separate from people's sessions.
