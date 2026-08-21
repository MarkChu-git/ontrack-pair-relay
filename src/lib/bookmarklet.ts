/**
 * The PERMANENT pairing bookmarklet. It carries no session data: the relay
 * origin (R) and this page's URL (P, for the CSP fallback) are baked in when
 * the user installs it, and the alert strings are baked in the install-time
 * language. Everything session-specific (the pairing code and the CLI's
 * one-time public key) is supplied per login by pasting the pairing link
 * into the bookmark's prompt, so the bookmark never needs re-installing.
 *
 * Readable reference version:
 *
 *   (async () => {
 *     // 1. Ask for this session's pairing link and parse c + k out of its
 *     //    fragment (the fragment never travels over the network).
 *     const link = prompt(<paste-link message>);
 *     if (!link) return;
 *     const h = new URLSearchParams(new URL(link).hash.slice(1));
 *     const code = h.get("c"), K = h.get("k");
 *     if (!code || !K) { alert(<bad-link message>); return; }
 *
 *     // 2. mailboxId = SHA-256 hex of the pairing code (matches ontrack-cli
 *     //    src/lib/pair-login.ts deriveMailboxId).
 *     const M = toHex(await crypto.subtle.digest("SHA-256", te.encode(code)));
 *
 *     // 3. Grab credentials, in order. Each source also fixes the `contract`
     *     //    the CLI must honour: an access token is already usable and has to
     *     //    be sent as-is, while a one-time login token still needs the
     *     //    `POST /auth` exchange. Offering an access token to `/auth` is
     *     //    answered with 419, which is why the source is reported.
     *     //    a. POST /api/auth/access-token — doubtfire >=11 keeps the token
     *     //       in memory only; the HttpOnly refresh_token cookie (carried
     *     //       automatically by the same-origin fetch) mints a fresh one.
     *     //       Response: {user: {username...}, auth_token, auth_token_expiry}.
     *     //       Tried first: unlike the landing-URL token below it is fresh,
     *     //       carries an expiry, and is not single-use.
     *     //    b. sign_in landing URL query (?authToken=...&username=...) — the
     *     //       web app strips it from the address bar on sign-in, so it is
     *     //       also read from the navigation timing entry, which keeps the
     *     //       URL the document was loaded with. Read even when (a) worked:
     *     //       exchanging one of these is the only way the CLI gets a
     *     //       refresh cookie, so it travels as the spare `exchangeToken`.
     *     //    c. legacy localStorage (doubtfire <=10):
     *     //       doubtfire_credentials_token / doubtfire_user, which is itself
     *     //       an API token.
 *     let authToken = "", username = "", contract, expiresAt, exchangeToken;
 *     const minted = await fetch("/api/auth/access-token", { method: "POST" });
 *     if (minted.ok) {
 *       const j = await minted.json();
 *       if (j && j.auth_token) {
 *         authToken = j.auth_token;
 *         contract = "access-token";
 *         expiresAt = j.auth_token_expiry;
 *         username = (j.user || {}).username || ...;
 *       }
 *     }
 *     {
 *       const queries = [new URLSearchParams(location.search)];
 *       const nav = performance.getEntriesByType("navigation")[0];
 *       if (nav && nav.name) queries.push(new URL(nav.name).searchParams);
 *       // The token and the username it names must come from the same URL.
 *       let landingToken = null, landingUser = null;
 *       for (const q of queries) {
 *         const t = q.get("authToken");
 *         if (t) { landingToken = t; landingUser = q.get("username"); break; }
 *       }
 *       if (!authToken) {
 *         if (landingToken) { authToken = landingToken; contract = "legacy-auth"; }
 *       } else if (landingToken && (!landingUser || landingUser === username)) {
 *         exchangeToken = landingToken;
 *       }
 *       if (!username) for (const q of queries) {
 *         const u = q.get("username");
 *         if (u) { username = u; break; }
 *       }
 *     }
 *     if (!authToken || !username) {
 *       let raw = localStorage.getItem("doubtfire_credentials_token"); // may be a JSON string
 *       if (raw && !authToken) {
 *         try { const p = JSON.parse(raw); if (typeof p === "string") raw = p; } catch {}
 *         authToken = raw;
 *         contract = "access-token";
 *       }
 *       const user = localStorage.getItem("doubtfire_user"); // JSON object
 *       if (user && !username) {
 *         const o = JSON.parse(user);
 *         username = o.username || o.user_name || o.login || o.email || o.student_email || "";
 *       }
 *     }
 *     if (!authToken || !username) { alert(<no-session message>); return; }
 *
 *     // 4. ECIES to the CLI's public key (must match encryptForCli in
 *     //    ontrack-cli src/lib/pair-login.ts):
 *     //      ephemeral ECDH P-256 -> deriveBits(256)
 *     //      -> HKDF-SHA256(salt = 32 zero bytes, info = "ontrack-pair-v1")
 *     //      -> AES-256-GCM, 12-byte random nonce
 *     //    envelope {"v":1,"eph":b64url(spki),"nonce":b64url,"ct":b64url}
 *     //    JSON.stringify drops the three optional fields when unset.
 *     const envelope = await eciesEncrypt(K, {
 *       authToken, username, expiresAt, contract, exchangeToken,
 *     });
 *
 *     // 5. Deliver: PUT R + "/m/" + M. If the OnTrack page CSP connect-src
 *     //    blocks fetch, fall back to navigating to
 *     //      P + "#d=" + encodeURIComponent(JSON.stringify(envelope)) + "&m=" + M
 *     //    so this page delivers it instead (fragments never hit the network).
 *   })();
 */
const BOOKMARKLET_LINES = [
  'javascript:(async()=>{',
  'const R=__R__,P=__P__,S=crypto.subtle,T=new TextEncoder(),J=JSON.stringify,L=localStorage,G={name:"ECDH",namedCurve:"P-256"};',
  'const b6=a=>{let s=btoa(String.fromCharCode(...new Uint8Array(a)));return s.split("+").join("-").split("/").join("_").replace(/=+$/,"")};',
  'const link=prompt(__MSG_PASTE_LINK__);',
  'if(!link)return;',
  'let code,K;',
  'try{const h=new URLSearchParams(new URL(link).hash.slice(1));code=h.get("c");K=h.get("k")}catch(e){}',
  'if(!code||!K){alert(__MSG_BAD_LINK__);return}',
  'const M=[...new Uint8Array(await S.digest("SHA-256",T.encode(code)))].map(b=>b.toString(16).padStart(2,"0")).join("");',
  // t/u are the credential, c its contract, x its expiry when the source knows
  // one. c decides whether the CLI may use the token directly or has to
  // exchange it, so it is set wherever t is. y is a spare one-time login token
  // the CLI can exchange for a renewable session.
  'let t,u,c,x,y;',
  // doubtfire >=11 keeps the token in memory only; mint a fresh one via the
  // HttpOnly refresh cookie (the same-origin fetch carries it automatically).
  // Tried first: the landing-URL token below is single-use and the web app has
  // usually already spent it by the time this bookmarklet runs.
  'try{',
  'const r=await fetch("/api/auth/access-token",{method:"POST"});',
  'if(r.ok){const j=await r.json();',
  'if(j&&j.auth_token){t=j.auth_token;c="access-token";x=j.auth_token_expiry;const o=j.user||{};u=o.username||o.user_name||o.login||o.email||o.student_email}}',
  '}catch(e){}',
  // sign_in?authToken=... landing URL: a pending one-time login token. Read it
  // even when minting already worked, because only exchanging one of these
  // earns the refresh cookie the CLI needs to renew silently. It is passed as a
  // spare (y) rather than the credential, since it may already be spent;
  // a spare naming a different user is dropped, as the CLI would exchange it
  // under the minted user's name. The web app strips the query from the address
  // bar on sign-in, which would leave nothing to read by the time a human
  // clicks the bookmark, so the navigation timing entry is read too: it keeps
  // the URL the document was loaded with, and history.replaceState cannot
  // touch it.
  'try{const Q=[new URLSearchParams(location.search)];',
  'try{const N=performance.getEntriesByType("navigation")[0];if(N&&N.name)Q.push(new URL(N.name).searchParams)}catch(e){}',
  // a and n must come from one URL, or the spare could be paired with a
  // username from elsewhere and defeat the same-user guard below.
  'let a=null,n=null;for(const q of Q){const z=q.get("authToken");if(z){a=z;n=q.get("username");break}}',
  'if(!t){if(a){t=a;c="legacy-auth"}}else if(a&&(!n||n===u))y=a;',
  'if(!u)for(const q of Q){const o=q.get("username");if(o){u=o;break}}}catch(e){}',
  // Legacy localStorage layout (doubtfire <=10), itself already an API token.
  'if(!t||!u)try{',
  'let v=L.getItem("doubtfire_credentials_token");',
  'if(v&&!t){try{const p=JSON.parse(v);if(typeof p=="string")v=p}catch(e){}t=v;c="access-token"}',
  'const w=L.getItem("doubtfire_user");',
  'if(w&&!u){const o=JSON.parse(w);u=o.username||o.user_name||o.login||o.email||o.student_email}',
  '}catch(e){}',
  'if(!t||!u){alert(__MSG_NOSESSION__);return}',
  // K is base64url of a P-256 SPKI (91 bytes), so it always needs exactly "==" padding.
  'const C=await S.importKey("spki",Uint8Array.from(atob(K.split("-").join("+").split("_").join("/")+"=="),c=>c.charCodeAt(0)),G,!1,[]);',
  'const E=await S.generateKey(G,!1,["deriveBits"]);',
  'const A=await S.deriveKey({name:"HKDF",hash:"SHA-256",salt:new Uint8Array(32),info:T.encode("ontrack-pair-v1")},await S.importKey("raw",await S.deriveBits({name:"ECDH",public:C},E.privateKey,256),"HKDF",!1,["deriveKey"]),{name:"AES-GCM",length:256},!1,["encrypt"]);',
  'const N=crypto.getRandomValues(new Uint8Array(12));',
  // J drops expiresAt/contract/exchangeToken when no source set them.
  'const D=J({v:1,eph:b6(await S.exportKey("spki",E.publicKey)),nonce:b6(N),ct:b6(await S.encrypt({name:"AES-GCM",iv:N},A,T.encode(J({authToken:t,username:u,expiresAt:x,contract:c,exchangeToken:y}))))});',
  // No content-type header: keeps the PUT a CORS "simple request" (no preflight).
  'try{const r=await fetch(R+"/m/"+M,{method:"PUT",body:D});',
  'if(!r.ok&&r.status!=409)throw 0;',
  'alert(__MSG_SENT__)}catch(e){',
  'location.href=P+"#d="+encodeURIComponent(D)+"&m="+M}',
  '})().catch(e=>alert(__MSG_FAILED_PREFIX__+(e&&e.message||e)))',
];

export interface BookmarkletParams {
  /** Relay origin (this page's origin). */
  R: string;
  /** This page's URL, target of the CSP-fallback `#d=` navigation. */
  P: string;
  /** prompt() text asking for this session's pairing link. */
  msgPasteLink: string;
  /** alert() text when the pasted text is not a pairing link. */
  msgBadLink: string;
  /** alert() text when no OnTrack session is found. */
  msgNoSession: string;
  /** alert() text after a successful (or duplicate) delivery. */
  msgSent: string;
  /** alert() prefix for unexpected failures. */
  msgFailedPrefix: string;
}

export function buildBookmarklet({
  R,
  P,
  msgPasteLink,
  msgBadLink,
  msgNoSession,
  msgSent,
  msgFailedPrefix,
}: BookmarkletParams): string {
  return BOOKMARKLET_LINES.join('')
    .replaceAll('__R__', JSON.stringify(R))
    .replaceAll('__P__', JSON.stringify(P))
    .replaceAll('__MSG_PASTE_LINK__', JSON.stringify(msgPasteLink))
    .replaceAll('__MSG_BAD_LINK__', JSON.stringify(msgBadLink))
    .replaceAll('__MSG_NOSESSION__', JSON.stringify(msgNoSession))
    .replaceAll('__MSG_SENT__', JSON.stringify(msgSent))
    .replaceAll('__MSG_FAILED_PREFIX__', JSON.stringify(msgFailedPrefix));
}
