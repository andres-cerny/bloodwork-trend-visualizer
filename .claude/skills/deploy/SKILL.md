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
4. `npm run test:all`.

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
