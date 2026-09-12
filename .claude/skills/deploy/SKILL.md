---
name: deploy
description: Deploy the four Workers in the order service bindings require, with the pre-flight checks that catch silent failures. Use when asked to deploy, ship, or push the demos live.
---

# Deploy

Four Workers, and the order is not optional: **a service binding to a Worker
that does not exist fails to deploy.** Capability workers first, shells second.

## Pre-flight

1. **Working tree clean?** `git status --short`. A deploy from a dirty tree
   ships something nobody can reconstruct.
2. **`.env` has `VITE_TURNSTILE_SITE_KEY`?** Without it both apps build fine and
   render "not enabled in this demo", which reads as a deliberate setting. The
   bundle check catches it — do not skip it.
3. **Secrets present in both capability workers?**
   `npx wrangler secret list -c workers/agent/wrangler.jsonc`, same for
   `extract`. They are per-Worker and do not migrate.
   **`SESSION_SECRET` must be identical in both** — a session minted by the
   extractor is verified by the agent, and they only agree if the HMAC key does.
4. **Is the live schema ahead of nothing?** `npm run check:schema`. Deploying
   a worker whose SQL names a column the database has not got 500s every
   request that touches it — see below. A non-zero exit here is never
   something to shrug past: "could not read the schema" is a failure, not a
   pass.
5. `npm run test:all`.

## The one failure the tests cannot see

On 2026-09-12 a portal deploy took login down for everyone. `db.ts` had grown
`budget_usd` in the two statements that read an account; the migration adding
that column had never been applied to the remote database; the commit carrying
the query went out anyway. Every login threw `no such column` before the
password was compared, which reaches the browser as a bare 500.

`npm run test:all` was green the whole time, and always would be: the portal
worker's tests fake D1 by dispatching on the exact SQL strings in `db.ts`, so a
statement naming a column that exists in no database passes all of them. The
gap is between the repo and one live database, and only that database can be
asked. That is what `check:schema` does.

**A migration is applied before the code that needs it is deployed, never
after.** The two are one change in the wrong order, and the wrong order is an
outage. `schema.sql` is the authority on the shape both must agree on.

## Deploy

```sh
npm run deploy          # agent, extract, bloodwork, chat — in that order
```

Individual: `deploy:agent`, `deploy:extract`, `deploy:bloodwork`, `deploy:chat`.
Each app target builds, then runs `check-bundle.mjs` against its own dist.

On the **first** deploy of the split, `/api/*` is briefly 5xx between the
capability workers landing and the shells picking them up. Say so before
starting if the demo is live.

## After

```sh
curl https://bloodwork-demo.andres-cerny.workers.dev/api/status
```

Confirm the two ledgers are separate, and that neither capability worker
resolves on its own `*.workers.dev` name — they are `workers_dev: false`, and if
one answers, it has a public origin it should not have.

**The Turnstile challenge cannot be verified from here.** Managed mode detects
and refuses Playwright, headless and headed — which is the feature working. It
needs one human click on the live URL, and it is the only path to upload or
chat, so nothing downstream of it is exercised until someone does that.

The current keys were confirmed working by hand on 2026-08-23 (challenge solved,
upload succeeded). Ask for a fresh check only after the site key or the secret
changes, or after a deploy to a new hostname — the pairing is per-hostname.
