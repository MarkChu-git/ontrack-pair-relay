/**
 * Mailbox API — a blind, one-shot mailbox for OnTrack CLI pairing.
 *
 * Protocol contract (see docs/PAIRING_RELAY_LOGIN_PLAN.md in ontrack-cli):
 *   mailboxId = SHA-256(pairing code) hex — the relay never sees the code.
 *   PUT  /m/<id>  stores an encrypted envelope once (409 if taken), TTL 300s.
 *   GET  /m/<id>  returns the envelope and deletes it (one-shot delivery).
 * The relay only ever handles ciphertext, and nothing about request bodies
 * is logged anywhere in this handler.
 *
 * Ported verbatim from the original plain-Worker implementation
 * (src/worker.ts) onto a TanStack Start server route.
 */
import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';

const MAILBOX_ID = /^[0-9a-f]{64}$/i;
const MAILBOX_TTL_SECONDS = 300; // pairing sessions live 5 minutes end to end
const MAX_BODY_BYTES = 8 * 1024; // envelopes are ~1KB; 8KB is generous
const WRITE_RATE_LIMIT = 60; // best-effort: max PUTs per IP per window
const WRITE_RATE_WINDOW_SECONDS = 60;

/** Every response carries the CORS origin header (the bookmarklet calls cross-origin). */
function respond(
  status: number,
  body?: string,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers({
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers.set(name, value);
    }
  }
  return new Response(body ?? null, { status, headers });
}

function handleOptions(): Response {
  return respond(204, undefined, {
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
}

function methodNotAllowed(): Response {
  return respond(405, '{"error":"method not allowed"}', {
    allow: 'GET, PUT, OPTIONS',
  });
}

function badMailboxId(): Response {
  return respond(400, '{"error":"mailbox id must be 64 hex characters"}');
}

/**
 * Best-effort per-IP write throttle backed by a KV counter. KV is eventually
 * consistent, so bursts can slip past; limiter failures fail open rather than
 * blocking a one-shot pairing delivery.
 */
async function isWriteRateLimited(ip: string): Promise<boolean> {
  try {
    const window = Math.floor(Date.now() / (WRITE_RATE_WINDOW_SECONDS * 1000));
    const key = `rl:${ip}:${window}`;
    const count = Number((await env.MAILBOXES.get(key)) ?? '0');
    if (count >= WRITE_RATE_LIMIT) {
      return true;
    }
    await env.MAILBOXES.put(key, String(count + 1), {
      expirationTtl: WRITE_RATE_WINDOW_SECONDS * 2,
    });
    return false;
  } catch {
    return false;
  }
}

async function handlePut(request: Request, id: string): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (await isWriteRateLimited(ip)) {
    return respond(429, '{"error":"rate limit exceeded"}');
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return respond(413, '{"error":"body too large"}');
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return respond(413, '{"error":"body too large"}');
  }

  // First writer owns the mailbox until it is read or expires, so an attacker
  // who guessed an id cannot swap in their own ciphertext. The check-and-set
  // is racy under concurrency, which is acceptable: the CLI authenticates the
  // envelope (AES-GCM) and simply ignores garbage.
  if ((await env.MAILBOXES.get(id)) !== null) {
    return respond(409, '{"error":"mailbox already exists"}');
  }
  await env.MAILBOXES.put(id, body, { expirationTtl: MAILBOX_TTL_SECONDS });
  return respond(200, '{}');
}

async function handleGet(id: string): Promise<Response> {
  const value = await env.MAILBOXES.get(id);
  if (value === null) {
    return respond(404, '{"error":"not found"}');
  }
  // One-shot delivery. A concurrent GET can observe the same value before the
  // delete lands; the CLI tolerates receiving its envelope twice.
  await env.MAILBOXES.delete(id);
  return respond(200, value);
}

export const Route = createFileRoute('/m/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!MAILBOX_ID.test(params.id)) {
          return badMailboxId();
        }
        return handleGet(params.id.toLowerCase());
      },
      PUT: async ({ request, params }) => {
        if (!MAILBOX_ID.test(params.id)) {
          return badMailboxId();
        }
        return handlePut(request, params.id.toLowerCase());
      },
      OPTIONS: () => handleOptions(),
      // The original worker rejects every other method before looking at the
      // path, so the catch-all answers 405 regardless of the id's shape.
      ANY: () => methodNotAllowed(),
    },
  },
});
