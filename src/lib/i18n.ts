/**
 * Pairing page copy, English and Chinese. The dictionaries are carried over
 * verbatim from the original static page (public/index.html); keep them in
 * sync if either side changes.
 */

export type Lang = 'en' | 'zh';

type DictEntry = string | ((arg: string) => string);

export const I18N: Record<Lang, Record<string, DictEntry>> = {
  en: {
    title: 'OnTrack CLI pairing',
    lede: 'Finish signing in to the OnTrack CLI on your remote machine. Your password never leaves this browser. Only an end-to-end encrypted token travels back through a blind relay.',
    errorTitle: 'This pairing link is incomplete',
    errorHint: 'Run',
    errorHint2: 'again to get a fresh link.',
    deliverTitle: 'Sending your login',
    step1Title: 'Add the pairing bookmark',
    step1Note: '(once, permanent)',
    step1Drag: 'Drag this button into your bookmarks bar:',
    bookmarkletLabel: 'OnTrack CLI pairing',
    copyBtn: 'Copy bookmarklet',
    step1Hint:
      'No bookmarks bar? Create a bookmark manually and paste the copied text as its URL. The bookmark contains no session data, so you only install it once: per login it simply asks for the current pairing link.',
    step2Title: 'Sign in to OnTrack',
    step2Btn: 'Open OnTrack sign-in ↗',
    step2Hint:
      'Complete your normal Monash SSO in the new tab, or skip this step entirely if you are already signed in. Your password and MFA never touch this page.',
    step3Title: 'Click the bookmark while on the OnTrack page',
    step3Body:
      'Click the bookmark, then paste this pairing link into its prompt. It reads your session token, encrypts it to your CLI, and drops it in the relay.',
    linkLabel: 'This session’s pairing link',
    copyLinkBtn: 'Copy link',
    statusWaiting: 'Waiting for your credential…',
    statusReceived: 'Encrypted credential received. Waiting for your CLI to collect it…',
    statusCollected: 'Your CLI collected it. Sign-in complete, you can close this page.',
    bmPasteLink: 'Paste this session’s pairing link (the one your CLI printed):',
    bmBadLink: 'That does not look like a pairing link. Copy the full link your CLI printed and try again.',
    altTitle: 'On a phone, or the bookmark did not work?',
    mobileTitle: 'On a phone? Install the bookmark in under a minute',
    mobileBody:
      'iOS: tap Share, then Add Bookmark, then edit it and replace its URL with the copied bookmarklet text. Android Chrome: bookmark this page, then edit its URL the same way. Afterwards open the OnTrack tab and tap the bookmark; it reads your session directly, no URL copying needed.',
    altHint:
      'Last resort: the sign_in?authToken=... URL flashes by too fast to copy from the address bar, but it stays in your browser history. Find that entry, copy its URL, and paste it here:',
    pasteBtn: 'Encrypt & send',
    codeLabel: 'Pairing code',
    codeNote:
      'Valid for about 5 minutes after your CLI printed the link. The relay only ever stores the encrypted envelope and deletes it on first read.',
    missing: (parts) => 'Missing ' + parts + ' in the link fragment.',
    missingC: 'c (the pairing code)',
    missingK: 'k (the CLI public key)',
    codeMalformed: 'The pairing code in the link is malformed.',
    keyMalformed: 'The CLI public key embedded in the link is malformed.',
    payloadMalformed:
      'The payload in this link is malformed. Go back to the OnTrack tab and click the bookmark again.',
    mailboxMissing:
      'This link is missing its mailbox id. Open the full pairing link from your CLI and try again.',
    sending: 'Sending your encrypted credential to the CLI…',
    sent: 'Sent. You can close this page. Your CLI will finish signing in automatically.',
    alreadySent: 'Already delivered. You can close this page.',
    rateLimited:
      'The relay is rate-limiting right now. Wait a minute, then go back and click the bookmark again.',
    relayHttp: (s) =>
      'The relay answered with HTTP ' + s + '. Go back to the OnTrack tab and click the bookmark again.',
    relayHttpRetry: (s) => 'The relay answered with HTTP ' + s + '. Try again.',
    relayUnreachable: (m) =>
      'Could not reach the relay (' + m + '). Check your connection and try again.',
    notUrl: 'That is not a valid URL.',
    wrongOrigin: 'The URL must be on https://ontrack.infotech.monash.edu.',
    noParams:
      'That URL has no authToken/username parameters. Copy the full address right after sign-in lands.',
    encrypting: 'Encrypting and sending…',
    failed: (m) => 'Failed: ' + m,
    dragFirst:
      'Drag this button into your bookmarks bar first. Then, after signing in, click it while you are on the OnTrack page.',
    copied: 'Copied!',
    copyFailed: 'Copy failed. Drag the button instead.',
    bmNoSession: 'No OnTrack session found. Sign in, then click this bookmark again.',
    bmSent: 'Sent to your CLI. You can close this tab.',
    bmFailed: (m) => 'Pairing failed: ' + m,
    unexpected: (m) => 'Unexpected error: ' + m,
  },
  zh: {
    title: 'OnTrack CLI 配对',
    lede: '完成远程机器上 OnTrack CLI 的登录。密码不会离开这个浏览器，只有一个端到端加密的令牌经由盲中继传回。',
    errorTitle: '配对链接不完整',
    errorHint: '重新运行',
    errorHint2: '获取新链接。',
    deliverTitle: '正在发送登录信息',
    step1Title: '添加配对书签',
    step1Note: '（一次，永久有效）',
    step1Drag: '把这个按钮拖进书签栏：',
    bookmarkletLabel: 'OnTrack CLI 配对',
    copyBtn: '复制 bookmarklet',
    step1Hint:
      '没有书签栏？手动新建一个书签，把复制的文本粘进 URL。书签不含任何会话数据，装一次永久有效：以后每次登录它只会跟你要一下本次配对链接。',
    step2Title: '登录 OnTrack',
    step2Btn: '打开 OnTrack 登录页 ↗',
    step2Hint: '在新标签页完成正常的 Monash SSO；已经登录的话直接跳过这步。密码和 MFA 不会接触本页面。',
    step3Title: '在 OnTrack 页面上点击书签',
    step3Body:
      '点击书签，把本次配对链接粘进弹出的输入框。它会读取你的会话令牌、加密给你的 CLI、投进中继。',
    linkLabel: '本次配对链接',
    copyLinkBtn: '复制链接',
    statusWaiting: '等待你的凭证…',
    statusReceived: '加密凭证已送达，等待 CLI 取走…',
    statusCollected: 'CLI 已取走凭证，登录完成。你可以关闭本页面。',
    bmPasteLink: '粘贴本次配对链接（CLI 打印的那条）：',
    bmBadLink: '这条链接不像配对链接。请复制 CLI 打印的完整链接重试。',
    altTitle: '在手机上，或书签没生效？',
    mobileTitle: '在手机上？一分钟内装好配对书签',
    mobileBody:
      'iOS：点「分享」→「添加书签」，然后编辑该书签，把 URL 换成复制的 bookmarklet 文本。Android Chrome：收藏本页后同样编辑 URL。之后打开 OnTrack 标签页点一下这个书签，它直接读取会话，完全不用复制 URL。',
    altHint:
      '最后手段：登录落地时 sign_in?authToken=... 的 URL 在地址栏一闪而过根本来不及复制，但它会留在浏览器历史记录里。找到那条记录，复制 URL 粘贴到这里：',
    pasteBtn: '加密并发送',
    codeLabel: '配对码',
    codeNote: 'CLI 打印链接后约 5 分钟内有效。中继只保存加密信封，首次读取即删除。',
    missing: (parts) => '链接片段中缺少 ' + parts + '。',
    missingC: 'c（配对码）',
    missingK: 'k（CLI 公钥）',
    codeMalformed: '链接中的配对码格式不正确。',
    keyMalformed: '链接中内嵌的 CLI 公钥格式不正确。',
    payloadMalformed: '链接中的载荷格式不正确。回到 OnTrack 标签页重新点击书签。',
    mailboxMissing: '链接缺少信箱 id。请打开 CLI 打印的完整配对链接重试。',
    sending: '正在把加密凭证发送给你的 CLI…',
    sent: '已发送。你可以关闭本页面，CLI 会自动完成登录。',
    alreadySent: '已投递过。你可以关闭本页面。',
    rateLimited: '中继正在限流。等一分钟后回到 OnTrack 标签页重新点击书签。',
    relayHttp: (s) => '中继返回了 HTTP ' + s + '。回到 OnTrack 标签页重新点击书签。',
    relayHttpRetry: (s) => '中继返回了 HTTP ' + s + '。请重试。',
    relayUnreachable: (m) => '无法连接中继（' + m + '）。检查网络后重试。',
    notUrl: '这不是一个有效的 URL。',
    wrongOrigin: 'URL 必须属于 https://ontrack.infotech.monash.edu。',
    noParams: '该 URL 没有 authToken/username 参数。请在登录落地后立即复制完整地址。',
    encrypting: '正在加密并发送…',
    failed: (m) => '失败：' + m,
    dragFirst: '请先把这个按钮拖进书签栏，登录完成后，在 OnTrack 页面上点击它。',
    copied: '已复制！',
    copyFailed: '复制失败，请直接拖拽按钮。',
    bmNoSession: '没有找到 OnTrack 会话。请先登录，然后再点一次这个书签。',
    bmSent: '已发送给你的 CLI。你可以关闭这个标签页。',
    bmFailed: (m) => '配对失败：' + m,
    unexpected: (m) => '意外错误：' + m,
  },
};

export function detectLanguage(navigatorLanguage: string | undefined): Lang {
  return (navigatorLanguage || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function translate(lang: Lang, key: string, arg?: string | number): string {
  const value = I18N[lang][key] ?? I18N.en[key];
  return typeof value === 'function' ? value(String(arg ?? '')) : value;
}
