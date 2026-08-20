/**
 * Checks the real bookmarklet source by executing it against stubbed browser
 * globals, then decrypting what it delivered to the relay.
 *
 * The bookmarklet runs on OnTrack's origin and can only be exercised by hand
 * there, so its two failure modes are both invisible until a user reports a
 * broken login: it can stop finding a credential when OnTrack changes, and it
 * can mislabel the credential it found. The label matters as much as the token
 * — an access token replayed through `POST /auth` is answered with 419 — so
 * every source is checked for the contract it reports.
 *
 * The bookmarklet is a `javascript:` URL, so exercising it means evaluating it:
 * the source comes from buildBookmarklet in this repository and every token here
 * is a fixture, so no real credential and no outside input reaches the eval.
 *
 * Usage: bun scripts/check-bookmarklet.ts
 * Exit code is 0 when every check passes, 1 otherwise.
 */
import { buildBookmarklet } from '../src/lib/bookmarklet';
import { b64urlDecode, deriveMailboxId } from '../src/lib/pair-crypto';

const RELAY = 'https://pair.example.test';
const PAGE = `${RELAY}/`;
const CODE = 'abcdefghijklmnop';
const MESSAGES = {
  msgPasteLink: 'Paste the pairing link',
  msgBadLink: 'That is not a pairing link',
  msgNoSession: 'No OnTrack session found',
  msgSent: 'Sent',
  msgFailedPrefix: 'Failed: ',
};

let failures = 0;

function expect(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`ok   - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(
      `FAIL - ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The CLI half of the pairing session: an ephemeral P-256 keypair. */
async function generateCliKeys(): Promise<{
  privateKey: CryptoKey;
  publicKeyBase64Url: string;
}> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
  return {
    privateKey: pair.privateKey,
    publicKeyBase64Url: base64
      .split('+')
      .join('-')
      .split('/')
      .join('_')
      .replace(/=+$/, ''),
  };
}

/** Mirror of decryptFromBrowser in ontrack-cli src/lib/pair-login.ts. */
async function decryptEnvelope(
  privateKey: CryptoKey,
  envelope: { v: number; eph: string; nonce: string; ct: string },
): Promise<Record<string, unknown>> {
  expect(envelope.v === 1, `envelope version must be 1, got ${envelope.v}`);
  const peer = await crypto.subtle.importKey(
    'spki',
    b64urlDecode(envelope.eph) as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peer },
    privateKey,
    256,
  );
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, [
    'deriveKey',
  ]);
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('ontrack-pair-v1'),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlDecode(envelope.nonce) as BufferSource },
    aesKey,
    b64urlDecode(envelope.ct) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
}

interface RunOptions {
  cliPublicKey: string;
  /** What the prompt receives; defaults to a well-formed pairing link. */
  link?: string;
  /** Query string of the OnTrack page the bookmarklet runs on. */
  search?: string;
  /** Answer for POST /api/auth/access-token; omit to make the mint fail. */
  mint?: { status: number; body?: unknown };
  storage?: Record<string, string>;
  /** Simulates an OnTrack CSP that blocks the cross-origin PUT. */
  blockRelayPut?: boolean;
}

interface RunResult {
  puts: { url: string; body: string }[];
  alerts: string[];
  navigations: string[];
}

async function runBookmarklet(options: RunOptions): Promise<RunResult> {
  const source = buildBookmarklet({ R: RELAY, P: PAGE, ...MESSAGES });
  expect(
    source.startsWith('javascript:'),
    'bookmarklet must be a javascript: URL',
  );

  const result: RunResult = { puts: [], alerts: [], navigations: [] };
  const locationStub = {
    search: options.search ?? '',
    get href(): string {
      return PAGE;
    },
    set href(value: string) {
      result.navigations.push(value);
    },
  };

  const fetchStub = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === '/api/auth/access-token') {
      expect(init?.method === 'POST', 'the mint must be a POST');
      if (!options.mint) {
        return new Response('{}', { status: 401 });
      }
      return new Response(JSON.stringify(options.mint.body ?? {}), {
        status: options.mint.status,
      });
    }
    if (url.startsWith(`${RELAY}/m/`)) {
      expect(init?.method === 'PUT', 'delivery must be a PUT');
      if (options.blockRelayPut) {
        throw new TypeError('Refused to connect because of Content Security Policy');
      }
      result.puts.push({ url, body: String(init?.body) });
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  const body = source.slice('javascript:'.length);
  // The bookmarklet reads these as free identifiers, so parameters shadow them.
  const invoke = new Function(
    'prompt',
    'alert',
    'fetch',
    'localStorage',
    'location',
    `return ${body}`,
  ) as (
    prompt: () => string | null,
    alert: (message: string) => void,
    fetch: typeof fetchStub,
    localStorage: { getItem(key: string): string | null },
    location: typeof locationStub,
  ) => Promise<void>;

  await invoke(
    () => options.link ?? `${RELAY}/#c=${CODE}&k=${options.cliPublicKey}`,
    (message: string) => {
      result.alerts.push(message);
    },
    fetchStub,
    { getItem: (key) => options.storage?.[key] ?? null },
    locationStub,
  );
  return result;
}

/** Deliver once and return the decrypted payload the CLI would receive. */
async function deliveredPayload(
  keys: { privateKey: CryptoKey; publicKeyBase64Url: string },
  options: Omit<RunOptions, 'cliPublicKey'>,
): Promise<Record<string, unknown>> {
  const run = await runBookmarklet({
    cliPublicKey: keys.publicKeyBase64Url,
    ...options,
  });
  expect(
    run.alerts.length === 1 && run.alerts[0] === MESSAGES.msgSent,
    `expected only the sent alert, got ${JSON.stringify(run.alerts)}`,
  );
  expect(run.puts.length === 1, `expected one PUT, got ${run.puts.length}`);
  expect(
    run.puts[0]?.url === `${RELAY}/m/${await deriveMailboxId(CODE)}`,
    'PUT must target the mailbox derived from the pairing code',
  );
  return decryptEnvelope(keys.privateKey, JSON.parse(run.puts[0]!.body));
}

const keys = await generateCliKeys();
const MINTED = {
  status: 201,
  body: {
    auth_token: 'minted-token',
    auth_token_expiry: '2026-08-21T00:00:00.000Z',
    user: { username: 'student1', role: 'student' },
  },
};

await check('a minted access token is delivered with its contract and expiry', async () => {
  const payload = await deliveredPayload(keys, { mint: MINTED });
  expect(payload.authToken === 'minted-token', 'the minted token must be delivered');
  expect(payload.username === 'student1', `username was ${payload.username}`);
  expect(payload.contract === 'access-token', `contract was ${payload.contract}`);
  expect(
    payload.expiresAt === '2026-08-21T00:00:00.000Z',
    `expiry was ${payload.expiresAt}`,
  );
  expect(!('exchangeToken' in payload), 'there is no landing-URL token to forward');
});

await check('minting wins, and a same-user landing token travels as the spare', async () => {
  // Exchanging that spare is the only way the CLI earns a refresh cookie, so it
  // must be forwarded even though minting already produced a usable token.
  const payload = await deliveredPayload(keys, {
    mint: MINTED,
    search: '?authToken=one-time-token&username=student1',
  });
  expect(payload.authToken === 'minted-token', 'minting must win over the landing URL');
  expect(payload.contract === 'access-token', `contract was ${payload.contract}`);
  expect(
    payload.exchangeToken === 'one-time-token',
    'the landing-URL token must be forwarded for the exchange',
  );
});

await check('a landing token naming another user is not forwarded', async () => {
  // The CLI would exchange it under the minted user's name, which is not who
  // that token belongs to.
  const payload = await deliveredPayload(keys, {
    mint: MINTED,
    search: '?authToken=one-time-token&username=someone-else',
  });
  expect(payload.authToken === 'minted-token', 'minting must win over the landing URL');
  expect(!('exchangeToken' in payload), 'a spare for another user must be dropped');
});

await check('a landing token without a username is forwarded as the spare', async () => {
  const payload = await deliveredPayload(keys, {
    mint: MINTED,
    search: '?authToken=one-time-token',
  });
  expect(payload.username === 'student1', `username was ${payload.username}`);
  expect(
    payload.exchangeToken === 'one-time-token',
    'an unattributed spare belongs to the signed-in browser session',
  );
});

await check('a landing-URL token is reported as the legacy exchange contract', async () => {
  const payload = await deliveredPayload(keys, {
    search: '?authToken=one-time-token&username=student1',
  });
  expect(payload.authToken === 'one-time-token', 'the landing-URL token must be delivered');
  expect(payload.username === 'student1', `username was ${payload.username}`);
  expect(payload.contract === 'legacy-auth', `contract was ${payload.contract}`);
  expect(!('expiresAt' in payload), 'a landing-URL token carries no expiry');
  expect(
    !('exchangeToken' in payload),
    'the credential itself needs no duplicate spare',
  );
});

await check('a legacy localStorage token is unwrapped and reported as live', async () => {
  const payload = await deliveredPayload(keys, {
    storage: {
      // doubtfire <=10 stored the token as a JSON string, quotes included.
      doubtfire_credentials_token: JSON.stringify('stored-token'),
      doubtfire_user: JSON.stringify({ username: 'student1' }),
    },
  });
  expect(payload.authToken === 'stored-token', 'the stored token must be delivered');
  expect(payload.username === 'student1', `username was ${payload.username}`);
  expect(payload.contract === 'access-token', `contract was ${payload.contract}`);
});

await check('no reachable credential alerts instead of delivering', async () => {
  const run = await runBookmarklet({ cliPublicKey: keys.publicKeyBase64Url });
  expect(run.puts.length === 0, 'nothing may be delivered without a credential');
  expect(
    run.alerts.length === 1 && run.alerts[0] === MESSAGES.msgNoSession,
    `expected the no-session alert, got ${JSON.stringify(run.alerts)}`,
  );
});

await check('a pasted link without code and key is refused', async () => {
  const run = await runBookmarklet({
    cliPublicKey: keys.publicKeyBase64Url,
    link: 'https://example.test/not-a-pairing-link',
    mint: MINTED,
  });
  expect(run.puts.length === 0, 'nothing may be delivered without a pairing key');
  expect(
    run.alerts.length === 1 && run.alerts[0] === MESSAGES.msgBadLink,
    `expected the bad-link alert, got ${JSON.stringify(run.alerts)}`,
  );
});

await check('a blocked cross-origin PUT falls back to the pairing page', async () => {
  const run = await runBookmarklet({
    cliPublicKey: keys.publicKeyBase64Url,
    mint: MINTED,
    blockRelayPut: true,
  });
  expect(run.navigations.length === 1, 'the CSP fallback must navigate once');
  const target = new URL(run.navigations[0]!);
  const fragment = new URLSearchParams(target.hash.slice(1));
  expect(
    `${target.origin}${target.pathname}` === PAGE,
    `fallback must return to the pairing page, got ${target.origin}${target.pathname}`,
  );
  expect(
    fragment.get('m') === (await deriveMailboxId(CODE)),
    'the fallback must name the mailbox to deliver to',
  );
  const payload = await decryptEnvelope(
    keys.privateKey,
    JSON.parse(fragment.get('d') ?? '{}'),
  );
  expect(payload.contract === 'access-token', `contract was ${payload.contract}`);
});

if (failures > 0) {
  console.error(`\n${failures} bookmarklet check(s) failed`);
  process.exit(1);
}
console.log('\nAll bookmarklet checks passed');
