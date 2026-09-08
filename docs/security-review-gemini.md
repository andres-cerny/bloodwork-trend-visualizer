# Security review — the Google Gemini reader

Scope: `git diff origin/main..main` over `workers/extract`, `packages/extraction`,
`packages/api-client`, `packages/agent/core/src/pricing.ts`,
`packages/lab-core/src/reconcile.ts`, `apps/bloodwork/src` and `apps/portal/src`.
The change adds a second model provider to the Worker that handles page images
of real medical documents. Read-only review; nothing here was changed.

Reviewed against [the invariants](constraints.md) — Privacy, and the Workers
rules — and the deploy procedure in [deploy.md](deploy.md).

**Verdict.** Flipping `PHOTO_READERS` to a Gemini pair on `bloodwork-extract`
(the public demo) is safe. Doing the same on `moje-krev-extract` is not, until
`apps/portal/src/ui/Privacy.tsx` names Google — that deployment holds real
family data and that page is the promise. Six findings follow, none of them a
hole an outsider can reach; four are one-line fixes worth taking in the same
sitting.

**All six are fixed as of 2026-09-08**, each with a test that failed first; a
resolution paragraph closes each finding below. The blocking one was taken as
the class fix rather than the smallest one — the processor sentence is rendered
from `/api/status` in both apps, so the copy follows the deployment instead of
following whoever remembers to edit it.

## Findings, worst first

### 1. The privacy copy and the deployment can disagree — silently, on the portal

`workers/portal-extract/wrangler.jsonc` is config over the *same code*
(`"main": "../extract/src/index.ts"`). Two commands — a `GEMINI_API_KEY` secret
and a `PHOTO_READERS` var — send redacted page images of real family data to
Google, while `apps/portal/src/ui/Privacy.tsx:41-46` still reads *"na náš server
a z něj do Anthropic API"*. Nothing fails, nothing warns, and the privacy page
is the one document whose sentences are supposed to be checkable against the
code (its own header says so).

`docs/constraints.md:230-234` states the obligation but enumerates only
`apps/bloodwork/src/App.tsx`, `apps/bloodwork/src/ui/UploadPanel.tsx` and
README. The portal's page was not in the list, so it was not updated.

Two smaller inaccuracies in the same class:

- `apps/bloodwork/src/App.tsx:523` and `apps/bloodwork/src/ui/UploadPanel.tsx:517`
  name Google unconditionally, while `workers/extract/wrangler.jsonc:31` ships
  `"sonnet+haiku"` and no key. The copy is currently false in the harmless
  direction. That is deliberate (`docs/constraints.md:233-235`) and it is the
  right call — over-disclosure ages safely, under-disclosure does not.
- `apps/bloodwork/src/App.tsx:526-527` and `docs/constraints.md:222-223` both
  claim the paid tiers *"neukládají"* / "neither train on nor store the
  request". Not training is a published commitment at both vendors; not storing
  is not — both retain inputs transiently for abuse monitoring. The sentence
  claims more than either provider offers.

**Smallest fix.** Add the Gemini clause to `Privacy.tsx`, and soften
*neukládají* to a claim about training and retention-for-reuse. **Class fix**,
which is the one worth doing: `/api/status` already returns `photoReaders`
(`workers/extract/src/index.ts:264`) and both apps already call it, so the
sentence can be rendered from the live configuration instead of being asserted
by hand. A notice driven by the deployment cannot be falsified by a config flip.

**Resolved 2026-09-08 — the class fix.** `processorPhrase` and
`RETENTION_NOTE` (`packages/ui-kit/src/processors.ts`) render the clause from
`photoReaders`, and all three surfaces call them: `App.tsx`, `UploadPanel.tsx`
and `Privacy.tsx`. The portal's page is reachable logged out, so the portal
worker gained a public `GET /api/processors` that asks its extractor binding
and answers `null` when it will not say. `null` — loading, failed, or an
unrecognised pair — names *both* processors: `sendsToGoogle` is an allowlist of
Anthropic-only pairs, so every direction it can be wrong in over-discloses.
The *neukládají* overclaim is gone from all four places that made it
(`App.tsx`, `UploadPanel.tsx`, `Privacy.tsx`, `constraints.md`); the copy now
claims training only. Pinned by `packages/ui-kit/tests/processors.test.ts` and
`workers/portal/tests/reports.test.ts`, and `docs/constraints.md` records the
render-from-status rule in place of the enumerate-the-surfaces one.

### 2. The outbound host is hardcoded by module resolution, not by this repo

`packages/extraction/src/gemini.ts:260` constructs `new GoogleGenAI({ apiKey })`
with no `httpOptions`. Where that lands depends on which build of `@google/genai`
the bundler picked:

- browser/workerd build — base URL is the literal
  `https://generativelanguage.googleapis.com/`
  (`node_modules/@google/genai/dist/web/index.mjs:13551`), and `getBaseUrl` is
  called with `undefined` for both environment overrides (`dist/web/index.mjs:25852-25854`).
- node build — the same call reads `getEnv('GOOGLE_GEMINI_BASE_URL')`
  (`dist/node/index.mjs:26278`).

Today the property holds: wrangler resolves the `browser` condition, and
`compatibility_date: "2025-01-01"` does not populate `process.env` from
bindings. But `docs/constraints.md:247` records "the Worker's only outbound
hosts are hardcoded" as a *code* property, and after this change it is a
*resolution* property, and nothing in the suite pins it.
`packages/extraction/tests/gemini.test.ts:185` does assert the host, but the
tests run in plain node (`workers/CLAUDE.md`, "Tests run in plain node"), so
they resolve the node build and prove a different one from the deployed
bundle.

No caller-controlled input reaches the destination either way; see the confirmed
list below.

**Smallest fix**, one line: `new GoogleGenAI({ apiKey, httpOptions: { baseUrl:
"https://generativelanguage.googleapis.com/" } })`. An explicit `baseUrl` is
returned immediately by `getBaseUrl` (`dist/web/index.mjs:50-60`), ahead of both
`setDefaultBaseUrls` and the environment, so the host stops depending on the
build — which is what makes the existing assertion in `gemini.test.ts:185`
worth something, since it then proves the same thing whichever build resolves.

**Resolved 2026-09-08.** `GEMINI_BASE_URL` and `geminiClientOptions`
(`packages/extraction/src/gemini.ts`) are the single construction site. The
test that proves it sets `GOOGLE_GEMINI_BASE_URL` to a different host and
asserts the request still leaves for `generativelanguage.googleapis.com`; it
failed before the fix, because the node build these tests resolve does honour
that variable (verified directly: without a `baseUrl` the SDK issued
`https://not-google.test/v1beta/models/…`).

### 3. No size cap on the demo's extract body, and `imageFullBase64` is an input no client sends

`workers/extract/src/index.ts:159-175` parses the whole request with
`request.json()` and applies no length limit. `textLayer` is truncated to 20000
(`packages/extraction/src/gemini.ts:195`) and `rowsText` to 40000
(`packages/extraction/src/extract.ts:298`); the two image fields are not, and
`imageFullBase64` is forwarded to Google uncut by design
(`GEMINI_IMAGE_MAX_EDGE = null`, `gemini.ts:89`).

The bloodwork shell forwards the body verbatim
(`apps/bloodwork/worker/index.ts:30-34`). The portal shell does cap it —
`workers/portal/src/index.ts:69` and `:244`, 6 MB, then a 413 — so the pattern
already exists in the repo and the demo path simply lacks it. A caller holding
one Turnstile session can post a body large enough to exhaust the isolate's
memory inside `request.json()`. It costs no model spend and burns one page of
the allowance per attempt, and nothing persists, so this is nuisance-grade
rather than dangerous.

Worth noting separately: no shipped client sends `imageFullBase64`.
`packages/api-client/src/index.ts:80-94` and
`apps/bloodwork/src/ui/UploadPanel.tsx` send `imageBase64` only; the sole
producer is `workers/extract/tests/routes.test.ts:511`. Until a client is wired
up, the field's entire live effect is to let a caller choose a second, larger
payload for the Google leg specifically.

**Smallest fix.** The portal's two lines, moved into `handleExtract` before the
parse: read `request.text()`, refuse over a cap, then `JSON.parse`.

**Resolved 2026-09-08**, one step earlier than suggested: the cap sits in the
demo's shell (`apps/bloodwork/worker/index.ts`), which is the portal's own
arrangement — same 6 MB, same `{ error: "too_large" }` 413. The shell is the
better place because `handleExtract` spends the page allowance *before* it
reads the body, so an oversize post refused there burned a page to be
rejected. `/api/chat` is untouched and still forwards its stream unread.
`imageFullBase64` is left as it is: no shipped client sends it, and removing an
unused field is a change to the request contract rather than a fix.

### 4. A billed Gemini call whose body will not parse is never booked to the ledger

`packages/extraction/src/gemini.ts:274` parses the response *after* the call has
already been made and billed, and `parseGeminiJson` throws on a body that is not
JSON (`:237-241`). The `Usage` from that same response is discarded with the
exception. In `workers/extract/src/index.ts:215-226` only fulfilled reads are
priced, so Google has charged for a call the ledger never sees.

The Anthropic path cannot do this: `toolInput`
(`packages/extraction/src/extract.ts:212-215`) returns `{}` rather than
throwing, so a malformed answer still fulfils and is still priced. This is the
one direction the change introduces that under-charges.

It is hard to force — temperature 0, `responseMimeType: "application/json"` and
a `responseSchema` — so treat it as under-counting, not as an exploit.

**Smallest fix.** Throw an error that carries the usage, and price rejected
reads whose reason has one.

**Resolved 2026-09-08**, exactly that. `BilledReadError` carries `model` and
`usage`; `extractPageGemini` reads the meter before it reads the answer and
wraps a parse failure in one; `billedUsage()` is what the Worker's
`Promise.allSettled` loop asks of a rejection before it prices it. The test
posts a page whose Gemini reply is billed and unparseable and asserts the
ledger grew by Gemini's rate for 2000/1000 tokens.

Everything else about pricing is right, and worth stating because the question
was asked: `MODEL_GEMINI = "gemini-3.8-flash"` (`gemini.ts:61`) is exactly the
key in `MODEL_PRICING` (`packages/agent/core/src/pricing.ts:23`), and the string
that reaches `priceUsd` is `r.value.model`, which is that constant. Thinking
tokens are folded into output (`gemini.ts:225`) — omitting them would have
under-charged. The announced 2027-01-01 doubling lives in `SCHEDULED_PRICING`
(`pricing.ts:36`) rather than in a comment. The unknown-model fallback is
`[3.0, 15.0]` (`pricing.ts:41`), four times Gemini's rate, so a mis-named model
freezes the demo early rather than late.

### 5. `PHOTO_READERS` fails closed for every value except an `Object.prototype` key

`workers/extract/src/index.ts:104` looks up `PHOTO_PAIRS[asked]` on a plain
object literal. `"constructor"`, `"__proto__"`, `"toString"` and `"valueOf"`
each return a truthy inherited value, so the `if (!pair)` fallback at `:105` is
skipped and `pair.includes("gemini")` at `:106` throws a `TypeError` (verified
locally). The result is a 500 from `/api/status`, and a 500 from `/api/extract`
*after* `consumePage` has already spent a page.

It never fails open. There is no value of `PHOTO_READERS` that reaches Google
without `GEMINI_API_KEY` also being set, because the key check is on the far
side of the lookup either way. So the security property holds; what is wrong is
the claim — in the function's own comment at `:96-100` and in
`workers/extract/wrangler.jsonc:29-30` — that an unrecognised value falls back.
For four values it crashes instead. Only a deploy-time var reaches this; no
request can.

**Smallest fix.** `Object.hasOwn(PHOTO_PAIRS, asked)`, or a null-prototype map.
The existing test at `workers/extract/tests/routes.test.ts:477` uses
`"sonnet+opus"`, which takes the own-property path; adding `"constructor"` to it
is the guard.

**Resolved 2026-09-08.** `Object.hasOwn(PHOTO_PAIRS, asked)`. The guard runs
all four inherited keys — `constructor`, `__proto__`, `toString`, `valueOf` —
through both `/api/status` and `/api/extract`, and asserts the fallback rather
than only the absence of a 500. The wrangler comments and the docstring that
promised a fallback are now true.

### 6. The provider's raw error text reaches the client, and the portal logs it

`workers/extract/src/index.ts:230` returns `String(why?.reason ?? "unknown")` in
a 502. For Gemini that is `ApiError.message`, which is `JSON.stringify` of
Google's own error body (`dist/web/index.mjs:14079-14085`) — Google's
diagnostics, never the request and never the key. This is the pre-existing
shape and the Anthropic SDK's errors arrive the same way, so the new provider is
handled no worse.

The new wrinkle is `parseGeminiJson`. When `JSON.parse` fails, V8 builds the
message from the *input*: `SyntaxError: Unexpected token 'O', "Omlouvam s"... is
not valid JSON`. That input is model output derived from the patient's page.
Ten characters, returned to the person who uploaded the page — harmless there.
It stops being harmless at `workers/portal/src/index.ts:267`, which
`console.error`s the extractor's `message` into Workers observability. That
deployment does not run Gemini today, which is the only reason this is not live.

**Smallest fix.** In `parseGeminiJson`, wrap the parse and throw a fixed string
rather than letting `JSON.parse`'s message escape.

**Resolved 2026-09-08**, at both ends. `parseGeminiJson` catches `JSON.parse`
and throws `"Gemini returned a body that is not JSON"` — a fixed string, no
input in it. The 502 no longer carries the reason at all: it answers
`extraction_failed` with a Czech sentence the reader can act on, so no provider
error text reaches a client on any path, Anthropic's included. The portal logs
`status` and `error` and drops `message`.

One judgement recorded rather than taken: **nothing new is logged inside
`workers/extract`.** "No `console.*` anywhere in `workers/extract/src`" is a
property this review confirmed, and buying a slightly richer log line by
spending it is a bad trade — the operator's sink is the portal's log, which
still names the status and the code.

## Confirmed sound

**Secret handling — CONFIRMED, no leak, and no worse than the Anthropic key.**
`GEMINI_API_KEY` is read once (`workers/extract/src/index.ts:193`), passed as an
argument, and set by the SDK as the `x-goog-api-key` *header*
(`dist/web/index.mjs:25726`, `:25744`). It never enters a URL for
`generateContent`; the only `?key=` construction in the SDK is the websocket
Live path (`dist/web/index.mjs:14426`, `:14715`), which nothing here calls.
Error messages are built from the response body, not from the request
(`dist/web/index.mjs:14060-14088`). There is no `console.*` anywhere in
`workers/extract/src`, `packages/extraction/src`, `packages/gate/src` or
`packages/agent/core/src`. The ledger stores numbers only
(`packages/gate/src/budget.ts:63`), and KV holds spend shards and page counts.
`/api/status` returns budget, maxPages, `crossCheck` and the pair *name*
(`index.ts:259-265`). V8 stack frames carry no argument values, so a thrown
stack cannot carry the key either. The single place the variable's name appears
in a message is `gemini.ts:258`, which names the variable, not its value.

**Caller-controlled destination — CONFIRMED none**, subject to finding 2.
Nothing from the request body chooses the model, the host, or an SDK option.
`photoReaders` (`index.ts:102-110`) reads `env` only. The model that reaches the
URL path is `READER_MODEL[id]` (`index.ts:58-62`), a closed map over a
three-value union. `mediaType` and `imageFullMediaType` *are* caller-controlled,
but land only in a JSON body field — `inlineData.mimeType` (`gemini.ts:188`),
and Anthropic's `media_type` (`extract.ts:313`) — never in a header or a URL, so
the worst outcome is a 400 from the provider.

**What crosses the boundary — CONFIRMED minimal.** The Gemini request
(`gemini.ts:185-212`) is exactly: the model id, one image part, an optional
text-layer hint truncated to 20000, one fixed Czech instruction, and a config
block of `SYSTEM_EXTRACT`, temperature, `maxOutputTokens`, `responseMimeType`,
the converted schema, thinking level and retry attempts. SDK-added headers are
content-type, user-agent, `x-goog-api-client` and the key. No filename, no
session id (`g.claims.sid` is used only as a KV key, `index.ts:143`), no
`cf-connecting-ip`, no request headers echoed. The Anthropic request
(`extract.ts:312-327`) carries the same classes of thing. Both do carry the
patient's identifiers, because the page image does and because
`TOOL.input_schema` asks for `patient_name` and `patient_id`
(`extract.ts:146-147`) — that is the disclosed design, not a leak, and finding 1
is about whether it stays disclosed.

**The gate — CONFIRMED, one path, no way around it.** `handleExtract` runs
`guard` — session HMAC plus the capability freeze — at `index.ts:135`, before it
reads the body; then `consumePage` at `:141`; and only then chooses readers at
`:183`. `extractPageGemini` has exactly one call site. A Gemini pair with no key
is refused at `:106`. Session TTL and the page allowance are untouched by this
change and apply per session. One pre-existing wrinkle: `consumePage`'s
read-modify-write (`budget.ts:106-111`) is not atomic, so concurrent pages
inside one session can slip past the allowance; the spend ceiling is the real
bound, as `deploy.md` already says.

**Denial of service and cost — bounded**, with finding 3 the exception.
`attempts: 3` is honoured — `config.httpOptions` is plumbed through to the
request (`dist/web/index.mjs:5798`) — and means three HTTP attempts in total,
not three retries on top of the call; without it the SDK default would be five
(`dist/web/index.mjs:13485`). Retries fire only on 408/429/5xx
(`dist/web/index.mjs:13490-13497`), which are not billed, so a retry storm
cannot outrun the budget in dollars. `maxOutputTokens: 8000` caps output. The
Gemini image part costs a fixed token budget whatever the pixel count
(`GEMINI_IMAGE_TOKENS`, `gemini.ts:76-79`), so a bigger image costs nothing more
at Google — the exposure from an uncapped image is memory, not money. A caller
cannot force the expensive path: which pair runs is `env`-only. What a caller
can do, and could before this change, is spend one Turnstile solve on the
session's whole page allowance; the budget is checked before the calls and the
spend booked after, so a burst overshoots the ceiling by roughly the number of
in-flight requests.

**The default — CONFIRMED.** `workers/extract/wrangler.jsonc:31` ships
`"PHOTO_READERS": "sonnet+haiku"`, no `GEMINI_API_KEY` is configured (it appears
only in the comment at `:36-39`), and `DEFAULT_PHOTO_READERS`
(`index.ts:89`) is the same string — so the shipped var and an unset var agree.
A Gemini pair without the key falls back (`index.ts:106-108`). Both properties
are pinned by `workers/extract/tests/routes.test.ts:455` and `:485`.
`workers/portal-extract/wrangler.jsonc:31` ships the same default with no key.
Unrecognised values fall back, except for finding 5's four prototype keys, which
fail loudly rather than open.

**Injection and the remaining classes.** Prompt injection from page content is
possible exactly as it was before: `textLayer` is caller-supplied and
concatenated into a part (`gemini.ts:195`), and the image is model-read text.
The blast radius is unchanged — the model has no tools, and the answer is
constrained by `responseSchema` and `responseMimeType`, so the worst outcome is
a wrong transcribed value. On the text path `isPrintedOnPage` rejects anything
not literally on the page; on the image path the only catch is disagreement
between the two readers, which is the axis this change improves (494 rows
flagged for a human against 5). Schema injection: none — `toGeminiSchema`
(`gemini.ts:207`) converts a frozen `as const` literal, nothing from the request
reaches it, and the converter throws on any keyword it does not recognise
(`gemini.ts:145-149`) rather than dropping it. Unbounded memory is finding 3;
error messages leaking internals is finding 6; nothing in the reviewed code logs
page content, and the only such sink is the portal's, also finding 6.

## Before flipping the var

1. On `bloodwork-extract`: nothing blocking. Findings 2, 3, 5 and 6 were each
   one line and are done.
2. On `moje-krev-extract`: finding 1 was blocking and is resolved — but
   *deploy the portal shell and the app together with the extractor*. The
   privacy page reads `GET /api/processors`, which only the new
   `workers/portal` build serves; against the old one it answers 401, which the
   page treats as unknown and so names Google whether or not Google is in use.
   Safe, and wrong in the direction that is safe, but it is not the sentence
   you want on a page nobody has flipped anything on yet.
