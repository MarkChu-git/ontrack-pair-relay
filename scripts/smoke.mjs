/**
 * Smoke test for a running ontrack-pair-relay worker.
 *
 * Usage:
 *   node scripts/smoke.mjs            # against http://127.0.0.1:8787 (wrangler dev)
 *   BASE_URL=https://pair.example.com node scripts/smoke.mjs
 *
 * Exit code is 0 when every check passes, 1 otherwise.
 */
import { randomBytes } from 'node:crypto';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');

let failures = 0;

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL - ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

const newMailboxId = () => randomBytes(32).toString('hex');
const envelope = { v: 1, eph: 'eph', nonce: 'nonce', ct: 'ct' };

const put = (id, body) =>
  fetch(`${BASE_URL}/m/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });

await check('PUT stores, GET delivers once, second GET is 404', async () => {
  const id = newMailboxId();
  const body = JSON.stringify(envelope);

  const created = await put(id, body);
  expect(created.status === 200, `PUT expected 200, got ${created.status}`);
  expect(created.headers.get('access-control-allow-origin') === '*', 'PUT missing CORS header');

  const delivered = await fetch(`${BASE_URL}/m/${id}`);
  expect(delivered.status === 200, `GET expected 200, got ${delivered.status}`);
  expect((await delivered.text()) === body, 'GET body does not match the PUT body');

  const gone = await fetch(`${BASE_URL}/m/${id}`);
  expect(gone.status === 404, `second GET expected 404, got ${gone.status}`);
});

await check('duplicate PUT is 409 and does not overwrite', async () => {
  const id = newMailboxId();
  const first = JSON.stringify(envelope);

  expect((await put(id, first)).status === 200, 'first PUT should succeed');
  const duplicate = await put(id, JSON.stringify({ v: 1, eph: 'x', nonce: 'y', ct: 'z' }));
  expect(duplicate.status === 409, `duplicate PUT expected 409, got ${duplicate.status}`);

  const delivered = await fetch(`${BASE_URL}/m/${id}`);
  expect((await delivered.text()) === first, 'duplicate PUT must not overwrite the first envelope');
});

await check('invalid mailbox id is 400', async () => {
  const response = await put('not-hex-at-all', JSON.stringify(envelope));
  expect(response.status === 400, `expected 400, got ${response.status}`);
});

await check('body over 8KB is 413', async () => {
  const id = newMailboxId();
  const response = await put(id, 'x'.repeat(8 * 1024 + 1));
  expect(response.status === 413, `expected 413, got ${response.status}`);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed against ${BASE_URL}`);
  process.exit(1);
}
console.log(`\nAll checks passed against ${BASE_URL}`);
