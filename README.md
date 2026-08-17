# ontrack-pair-relay

Blind relay + static pairing page for `ontrack login` in headless environments
(VPS / SSH / CI). The CLI prints a pairing URL; the user completes the real
Monash SSO in their own browser; a per-session bookmarklet encrypts the session
token to the CLI's ephemeral public key and drops it in a one-shot relay
mailbox. The relay only ever sees a mailbox hash and ciphertext.

The full protocol design lives in the sibling repository:
`ontrack-cli/docs/PAIRING_RELAY_LOGIN_PLAN.md`. The CLI-side crypto reference
implementation is `ontrack-cli/src/lib/pair-login.ts` — the browser-side code
in `public/index.html` must stay byte-compatible with it.

## What's here

- `src/worker.ts` — Cloudflare Worker, plain fetch handler, no framework:
  - `PUT /m/<64-hex>`: stores the envelope once (409 if the mailbox is taken),
    bodies over 8KB rejected (413), KV `expirationTtl` 300s.
  - `GET /m/<64-hex>`: returns the envelope and deletes it (one-shot), 404 if empty.
  - Everything else: 404 / 405. CORS `Access-Control-Allow-Origin: *` on all
    responses, `OPTIONS` preflight answers 204.
  - Best-effort per-IP write throttle: 60 PUTs per 60s window, then 429.
  - No request body is ever logged.
- `public/index.html` — dependency-free pairing page served by the same worker:
  - Reads `#c=<code>&k=<base64url(spki)>` from the URL fragment (never sent
    over the network) and generates the session bookmarklet.
  - Three-step flow: drag bookmarklet to the bookmarks bar (first time) →
    open OnTrack sign-in → click the bookmark on the OnTrack page.
  - Fallbacks: copyable bookmarklet, a paste-the-landing-URL form (mobile),
    and a `#d=` receiver for when OnTrack's CSP blocks the bookmarklet's fetch
    (the bookmarklet navigates to `#d=<envelope>&m=<mailboxId>` and this page
    delivers it).
  - ECIES matches the CLI exactly: ECDH P-256 → HKDF-SHA256 (salt = 32 zero
    bytes, info `ontrack-pair-v1`) → AES-256-GCM, 12-byte nonce, envelope
    `{"v":1,"eph","nonce","ct"}` base64url without padding.
- `scripts/smoke.mjs` — smoke test against a running worker.

## Deploy

```sh
npm install                      # installs wrangler (dev dependency)
npx wrangler login
npx wrangler kv:namespace create MAILBOXES
# paste the printed id into wrangler.toml (replace REPLACE_WITH_KV_NAMESPACE_ID)
npm run deploy
```

Then bind a custom domain so the URL is stable and memorable
(Cloudflare dashboard → Workers & Pages → `ontrack-pair-relay` →
Settings → Domains & Routes → Add → Custom Domain, e.g. `pair.example.com`).
The same origin serves both the pairing page and `/m/*`, so no extra routing
configuration is needed.

**After deploying**, update the CLI so `ontrack login` prints the real URL:
set `DEFAULT_RELAY_URL` in `ontrack-cli/src/lib/pair-login.ts` to the deployed
origin. For ad-hoc testing you can instead use `ONTRACK_RELAY_URL` or
`ontrack login --relay-url <url>`.

## Develop

```sh
npm run dev                      # wrangler dev on http://127.0.0.1:8787
npm run smoke                    # smoke test against wrangler dev
BASE_URL=https://pair.example.com npm run smoke   # against production
```

The smoke test covers: PUT → GET → GET 404 (one-shot delivery), duplicate PUT
409 without overwrite, invalid id 400, oversized body 413.

## Notes

- The pairing page derives everything from the URL fragment and its own
  origin — there is no build step and no per-deploy configuration in the HTML.
- Pairing codes are single-use and the mailbox expires after 5 minutes; an
  expired or consumed mailbox just makes the CLI keep waiting until timeout,
  after which it falls back to manual URL capture.
