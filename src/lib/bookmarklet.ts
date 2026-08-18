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
 *     // 3. Grab credentials: sign_in landing URL query first, then OnTrack localStorage.
 *     const q = new URLSearchParams(location.search);
 *     let authToken = q.get("authToken") || "";
 *     let username = q.get("username") || "";
 *     if (!authToken || !username) {
 *       let raw = localStorage.getItem("doubtfire_credentials_token"); // may be a JSON string
 *       if (raw && !authToken) {
 *         try { const p = JSON.parse(raw); if (typeof p === "string") raw = p; } catch {}
 *         authToken = raw;
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
 *     const envelope = await eciesEncrypt(K, { authToken, username });
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
  'let t,u;',
  'try{const q=new URLSearchParams(location.search);t=q.get("authToken");u=q.get("username")}catch(e){}',
  'if(!t||!u)try{',
  'let v=L.getItem("doubtfire_credentials_token");',
  'if(v&&!t){try{const p=JSON.parse(v);if(typeof p=="string")v=p}catch(e){}t=v}',
  'const w=L.getItem("doubtfire_user");',
  'if(w&&!u){const o=JSON.parse(w);u=o.username||o.user_name||o.login||o.email||o.student_email}',
  '}catch(e){}',
  'if(!t||!u){alert(__MSG_NOSESSION__);return}',
  // K is base64url of a P-256 SPKI (91 bytes), so it always needs exactly "==" padding.
  'const C=await S.importKey("spki",Uint8Array.from(atob(K.split("-").join("+").split("_").join("/")+"=="),c=>c.charCodeAt(0)),G,!1,[]);',
  'const E=await S.generateKey(G,!1,["deriveBits"]);',
  'const A=await S.deriveKey({name:"HKDF",hash:"SHA-256",salt:new Uint8Array(32),info:T.encode("ontrack-pair-v1")},await S.importKey("raw",await S.deriveBits({name:"ECDH",public:C},E.privateKey,256),"HKDF",!1,["deriveKey"]),{name:"AES-GCM",length:256},!1,["encrypt"]);',
  'const N=crypto.getRandomValues(new Uint8Array(12));',
  'const D=J({v:1,eph:b6(await S.exportKey("spki",E.publicKey)),nonce:b6(N),ct:b6(await S.encrypt({name:"AES-GCM",iv:N},A,T.encode(J({authToken:t,username:u}))))});',
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
