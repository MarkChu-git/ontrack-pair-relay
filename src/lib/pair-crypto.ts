/**
 * Browser-side ECIES for the pairing page — byte-compatible with
 * encryptForCli in ontrack-cli src/lib/pair-login.ts:
 *   ephemeral ECDH P-256 -> deriveBits(256)
 *   -> HKDF-SHA256 (salt = 32 zero bytes, info = "ontrack-pair-v1")
 *   -> AES-256-GCM, 12-byte random nonce
 * envelope {"v":1,"eph":b64url(spki),"nonce":b64url,"ct":b64url}, no padding.
 */

export interface PairCredentialPayload {
  authToken: string;
  username: string;
  expiresAt?: string;
  /**
   * Which contract the captured credential belongs to. 'access-token' is
   * already a live API token and the CLI must use it as-is; 'legacy-auth' is a
   * pending one-time login token the CLI still has to exchange through
   * `POST /auth`. Offering the former there is answered with 419, so getting
   * this wrong costs the whole login. Mirrors CredentialContract in ontrack-cli
   * src/lib/types.ts; omit it and the CLI asks the server instead.
   */
  contract?: 'access-token' | 'legacy-auth';
}

export interface RelayEnvelope {
  v: 1;
  eph: string;
  nonce: string;
  ct: string;
}

const subtle = crypto.subtle;
const textEncoder = new TextEncoder();

export const b64urlEncode = (buf: ArrayBuffer | Uint8Array): string => {
  const s = btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
  return s.split('+').join('-').split('/').join('_').replace(/=+$/, '');
};

export const b64urlDecode = (value: string): Uint8Array => {
  let s = value.split('-').join('+').split('_').join('/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** mailboxId = SHA-256 hex of the 16-char base32 pairing code. */
export async function deriveMailboxId(code: string): Promise<string> {
  return toHex(await subtle.digest('SHA-256', textEncoder.encode(code)));
}

/**
 * ECIES encrypt — must stay in sync with encryptForCli in ontrack-cli
 * src/lib/pair-login.ts.
 */
export async function encryptForCli(
  cliPublicKeyBase64Url: string,
  payload: PairCredentialPayload,
): Promise<RelayEnvelope> {
  const cliKey = await subtle.importKey(
    'spki',
    b64urlDecode(cliPublicKeyBase64Url) as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ephemeral = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const sharedBits = await subtle.deriveBits(
    { name: 'ECDH', public: cliKey },
    ephemeral.privateKey,
    256,
  );
  const hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, [
    'deriveKey',
  ]);
  const aesKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: textEncoder.encode('ontrack-pair-v1'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    aesKey,
    textEncoder.encode(JSON.stringify(payload)),
  );
  const ephSpki = await subtle.exportKey('spki', ephemeral.publicKey);
  return {
    v: 1,
    eph: b64urlEncode(ephSpki),
    nonce: b64urlEncode(nonce),
    ct: b64urlEncode(new Uint8Array(ciphertext)),
  };
}

/** Verify that a string is an importable P-256 SPKI (used for link validation). */
export async function validateCliPublicKey(
  cliPublicKeyBase64Url: string,
): Promise<boolean> {
  try {
    await subtle.importKey(
      'spki',
      b64urlDecode(cliPublicKeyBase64Url) as BufferSource,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    return true;
  } catch {
    return false;
  }
}

export function putEnvelope(
  origin: string,
  mailboxId: string,
  body: string,
): Promise<Response> {
  return fetch(`${origin}/m/${mailboxId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
