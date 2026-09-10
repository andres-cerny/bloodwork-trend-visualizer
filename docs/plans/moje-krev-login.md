# Plan: Moje krev — password login

Decided with Ondrej on 2026-09-05. Replaces the email magic link, which only
ever reached his own address (Resend without a domain), with email + password.
Sign-up stays invitation-only: the only door is a link he sends, valid 24 hours.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Login | Email + password, one button, no sign-up button anywhere | Traditional, works for family today, needs no mail |
| Sign-up | Only through a link Ondrej sends; valid 24 hours; one use | No open registration, nobody random spends the budget |
| Password rule | Minimum 8 characters, nothing else | It is a demo; length is the only rule that helps |
| Session | Unchanged: the signed cookie, 90 days | Already right |
| Magic link | Removed entirely, with `login_tokens` and the mail sender | Less surface; nothing left that fails silently for everyone but Ondrej |
| Forgotten password | A link Ondrej mints and sends by hand, same mechanism as sign-up | No domain, no mail; email reset later changes one route |
| Hashing | PBKDF2-SHA256 via Web Crypto, per-user 16-byte salt, iteration count stored on the row | No bcrypt in Workers; storing the count lets it rise later without re-hashing everyone |

## Backend (`workers/portal`)

- `users` gains `password_hash`, `password_salt`, `password_iters`. Accounts
  without a password (Ondrej's, today) cannot log in until a set-password link
  is used.
- `invites` gains `expires_at` and an optional `user_id`. Unbound = sign-up
  link; bound = set-password link for that account. Both single-use, both 24 h.
- `POST /api/auth/register` `{ code, email, password }`: code live and
  unbound, email unused, password ≥ 8; creates the user, burns the code, sets
  the cookie. Same generic error for every refusal.
- `POST /api/auth/login` `{ email, password }`: verify, set cookie. Failures
  per email counted in D1 (the pattern `countRecentLoginTokens` used);
  after 10 in 15 minutes the email is refused for 15 minutes. Wrong email and
  wrong password answer identically.
- `POST /api/auth/password` `{ code, password }`: code live and bound; sets
  the hash, burns the code, sets the cookie.
- `GET /api/auth/invite/<code>`: `{ kind: "signup" | "password" }` or 404, so
  the page can show the right form or the one-sentence refusal.
- Delete: `confirmGet`, `confirmPost`, `handleLogin`'s mail path, `email.ts`,
  `MailEnv`, `login_tokens` and its SQL; `MAIL_FROM`/`RESEND_API_KEY` secrets
  become unused (leave them; secrets do not migrate).
- **Free-plan CPU check.** The free plan allows 10 ms of CPU per request and
  one PBKDF2 run is the request's whole cost. Measured 2026-09-05 on the
  development machine as a proxy (Node 22.23, Apple silicon, OpenSSL,
  `crypto.subtle.deriveBits`, median of 7): 100 000 iterations = 8.3 ms,
  200 000 = 16.5 ms, 300 000 = 24.5 ms, 600 000 = 49.5 ms — linear, so
  50 000 ≈ 4.1 ms. Cloudflare's cores are not faster than this laptop, so
  100 000 would spend the whole budget on the hash alone. **Chosen:
  `PBKDF2_ITERATIONS = 50_000`** (`workers/portal/src/password.ts`, one
  constant), leaving half the budget for the D1 round-trips and JSON around
  it. Still to do after deploy: read the real CPU time of one login from the
  worker's observability, and if it sits under 5 ms raise the constant to
  100 000 — every row stores its own count, so old passwords keep verifying
  and a row moves to the new count the next time its password is set. The
  paid plan (30 s) is the alternative if OWASP's 600 000 ever matters here.
- `tools/scripts/moje-krev-invites.mjs` prints a full URL
  (`/registrace?kod=…` or `/heslo?kod=…`), takes `--email` to mint a bound
  set-password link, and expires everything it mints in 24 h.

## Frontend (`apps/portal`)

- Front page: email, password, "Přihlásit se". Under it: "Zapomenuté heslo?
  Napište mi a pošlu vám odkaz." No sign-up button.
- `/registrace?kod=…`: asks the server about the code on open. Live: email,
  heslo, heslo znovu, "Vytvořit účet"; on success straight into the empty
  portal. Dead: "Odkaz už neplatí. Napište mi a pošlu nový."
- `/heslo?kod=…`: the same without the email field, "Nastavit heslo".
- Password fields show the 8-character rule as a hint before the first error,
  not as an error afterwards.

## Tests (plain node, fake D1)

Hash round trip; register refuses expired, spent and bound codes; login
refuses a wrong password and an unknown email with the same body; lockout
after the tenth failure; set-password link changes the hash and leaves
reports untouched; a user without a password cannot log in; the invite script
output parses back into a live code.

## Deploy

Schema additions are `ALTER TABLE … ADD COLUMN` (D1 supports it), in
`workers/portal/migrations/2026-09-05-password.sql`, applied once with
`npx wrangler d1 execute moje-krev --remote --file migrations/2026-09-05-password.sql`
from `workers/portal`; `schema.sql` carries the same shape for a fresh
database. The migration also drops `login_tokens` — it held only hashes of
fifteen-minute tokens, and nothing reads it after this deploy. After deploy,
mint Ondrej a set-password link with `--email`, he sets his password, then
the old cookie keeps working until it expires. Gates as usual: tests,
typecheck, docs:check, build, `test:audit:portal` — which now also sweeps the
two link pages, live and dead.

Built 2026-09-05 on branch `password-login`; the lockout, the expiry check,
the one-body refusals and the bound/unbound split were each shown failing by
reintroducing the fault before the branch was committed.
