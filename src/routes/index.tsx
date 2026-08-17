import { useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import { buildBookmarklet } from '../lib/bookmarklet';
import { detectLanguage, translate, type Lang } from '../lib/i18n';
import {
  deriveMailboxId,
  encryptForCli,
  putEnvelope,
  validateCliPublicKey,
} from '../lib/pair-crypto';

export const Route = createFileRoute('/')({ component: PairingPage });

type View = 'boot' | 'error' | 'deliver' | 'pair';
type StatusKind = 'ok' | 'err' | 'info';
/**
 * Messages are stored as i18n keys, not pre-computed strings, so they follow
 * the active language when the user toggles it after the fact.
 */
interface StatusMessage {
  kind: StatusKind;
  key: string;
  arg?: string | number;
}

/** Session values needed to rebuild the bookmarklet on language switch. */
interface PairSession {
  K: string;
  R: string;
  M: string;
  P: string;
  source: string;
}

function PairingPage() {
  const [lang, setLang] = useState<Lang>('en');
  const [view, setView] = useState<View>('boot');
  const [errorDetail, setErrorDetail] = useState<{
    key: string;
    arg?: string | number;
    missingC?: boolean;
    missingK?: boolean;
  } | null>(null);
  const [deliverStatus, setDeliverStatus] = useState<StatusMessage | null>(null);
  const [pairStatus, setPairStatus] = useState<StatusMessage | null>(null);
  const [bookmarkletHref, setBookmarkletHref] = useState('#');
  const [displayCode, setDisplayCode] = useState('');
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  const pairSessionRef = useRef<PairSession | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = (key: string, arg?: string | number) => translate(lang, key, arg);

  // Keep <html lang> and <title> in sync with the active language.
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = translate(lang, 'title');
  }, [lang]);

  function rebuildBookmarklet(langNow: Lang) {
    const session = pairSessionRef.current;
    if (!session) return;
    const source = buildBookmarklet({
      K: session.K,
      R: session.R,
      M: session.M,
      P: session.P,
      msgNoSession: translate(langNow, 'bmNoSession'),
      msgSent: translate(langNow, 'bmSent'),
      msgFailedPrefix: translate(langNow, 'bmFailed', ''),
    });
    session.source = source;
    setBookmarkletHref(source);
  }

  /** `#d=` fallback receiver: the bookmarklet bounced its envelope here. */
  async function deliverMode(params: URLSearchParams) {
    setView('deliver');
    const raw = params.get('d');
    const mailbox =
      params.get('m') ||
      (params.get('c') ? await deriveMailboxId(params.get('c') as string) : null);

    let envelope: unknown = null;
    try {
      envelope = JSON.parse(raw as string);
    } catch {
      envelope = null;
    }
    const record = envelope as Record<string, unknown> | null;
    const shapeOk =
      record &&
      record.v === 1 &&
      typeof record.eph === 'string' &&
      typeof record.nonce === 'string' &&
      typeof record.ct === 'string';
    if (!shapeOk) {
      setDeliverStatus({ kind: 'err', key: 'payloadMalformed' });
      return;
    }
    if (!mailbox || !/^[0-9a-f]{64}$/i.test(mailbox)) {
      setDeliverStatus({ kind: 'err', key: 'mailboxMissing' });
      return;
    }

    setDeliverStatus({ kind: 'info', key: 'sending' });
    try {
      const response = await putEnvelope(window.location.origin, mailbox, raw as string);
      if (response.ok) {
        setDeliverStatus({ kind: 'ok', key: 'sent' });
      } else if (response.status === 409) {
        setDeliverStatus({ kind: 'ok', key: 'alreadySent' });
      } else if (response.status === 429) {
        setDeliverStatus({ kind: 'err', key: 'rateLimited' });
      } else {
        setDeliverStatus({ kind: 'err', key: 'relayHttp', arg: response.status });
      }
    } catch (error) {
      setDeliverStatus({
        kind: 'err',
        key: 'relayUnreachable',
        arg: (error as Error)?.message || String(error),
      });
    }
  }

  async function pairMode(langNow: Lang, params: URLSearchParams) {
    const code = params.get('c');
    const key = params.get('k');

    if (!code || !key) {
      setErrorDetail({ key: 'missing', missingC: !code, missingK: !key });
      setView('error');
      return;
    }
    if (!/^[a-z2-7]{16}$/.test(code as string)) {
      setErrorDetail({ key: 'codeMalformed' });
      setView('error');
      return;
    }
    if (!(await validateCliPublicKey(key as string))) {
      setErrorDetail({ key: 'keyMalformed' });
      setView('error');
      return;
    }

    const mailbox = await deriveMailboxId(code as string);
    pairSessionRef.current = {
      K: key as string,
      R: window.location.origin,
      M: mailbox,
      P: window.location.origin + window.location.pathname,
      source: '',
    };
    rebuildBookmarklet(langNow);

    setDisplayCode((code as string).replace(/(.{4})(?=.)/g, '$1-'));
    setView('pair');
  }

  // Bootstrap: detect the language, then parse the URL fragment (it never
  // leaves the browser, so all of this happens client-side after mount).
  useEffect(() => {
    const langNow = detectLanguage(navigator.language);
    setLang(langNow);
    (async () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      if (params.get('d')) {
        await deliverMode(params);
        return;
      }
      await pairMode(langNow, params);
    })().catch((error) => {
      setErrorDetail({
        key: 'unexpected',
        arg: (error as Error)?.message || String(error),
      });
      setView('error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleLang = () => {
    const next: Lang = lang === 'zh' ? 'en' : 'zh';
    setLang(next);
    rebuildBookmarklet(next);
  };

  const onBookmarkletClick = (event: React.MouseEvent) => {
    event.preventDefault();
    setPairStatus({ kind: 'info', key: 'dragFirst' });
  };

  const onCopyBookmarklet = async () => {
    const session = pairSessionRef.current;
    if (!session) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(session.source);
      copied = true;
    } catch {
      const area = document.createElement('textarea');
      area.value = session.source;
      document.body.appendChild(area);
      area.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
      area.remove();
    }
    setCopyLabel(copied ? 'copied' : 'copyFailed');
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyLabel(null), 2500);
  };

  // Mobile / no-bookmarklet fallback: paste the sign_in landing URL.
  const onPasteSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const session = pairSessionRef.current;
    if (!session) return;
    const input = event.currentTarget.elements.namedItem('paste-url') as HTMLInputElement;
    let url: URL;
    try {
      url = new URL(input.value.trim());
    } catch {
      setPairStatus({ kind: 'err', key: 'notUrl' });
      return;
    }
    if (url.origin !== 'https://ontrack.infotech.monash.edu') {
      setPairStatus({ kind: 'err', key: 'wrongOrigin' });
      return;
    }
    const authToken = url.searchParams.get('authToken');
    const username = url.searchParams.get('username');
    if (!authToken || !username) {
      setPairStatus({ kind: 'err', key: 'noParams' });
      return;
    }
    setPairStatus({ kind: 'info', key: 'encrypting' });
    try {
      const envelope = await encryptForCli(session.K, { authToken, username });
      const response = await putEnvelope(
        window.location.origin,
        session.M,
        JSON.stringify(envelope),
      );
      if (response.ok) {
        setPairStatus({ kind: 'ok', key: 'sent' });
      } else if (response.status === 409) {
        setPairStatus({ kind: 'ok', key: 'alreadySent' });
      } else if (response.status === 429) {
        setPairStatus({ kind: 'err', key: 'rateLimited' });
      } else {
        setPairStatus({ kind: 'err', key: 'relayHttpRetry', arg: response.status });
      }
    } catch (error) {
      setPairStatus({
        kind: 'err',
        key: 'failed',
        arg: (error as Error)?.message || String(error),
      });
    }
  };

  return (
    <main className="card">
      <div className="topbar">
        <span className="brand">ontrack-cli // pair</span>
        <button id="lang-toggle" className="lang-toggle" type="button" onClick={toggleLang}>
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
      </div>

      <h1>{t('title')}</h1>
      <p className="lede">{t('lede')}</p>
      <noscript>
        <p className="status err">
          This page needs JavaScript (WebCrypto) to pair.
          <br />
          本页面需要启用 JavaScript（WebCrypto）才能完成配对。
        </p>
      </noscript>

      <section id="view-error" hidden={view !== 'error'}>
        <h2>{t('errorTitle')}</h2>
        <p id="error-detail" className="muted">
          {errorDetail
            ? errorDetail.key === 'missing'
              ? t(
                  'missing',
                  [
                    errorDetail.missingC ? t('missingC') : null,
                    errorDetail.missingK ? t('missingK') : null,
                  ]
                    .filter(Boolean)
                    .join(lang === 'zh' ? ' 和 ' : ' and '),
                )
              : t(errorDetail.key, errorDetail.arg)
            : null}
        </p>
        <p className="muted">
          {t('errorHint')} <code>ontrack login</code> {t('errorHint2')}
        </p>
      </section>

      <section id="view-deliver" hidden={view !== 'deliver'}>
        <h2>{t('deliverTitle')}</h2>
        <p
          id="deliver-status"
          className={deliverStatus ? `status ${deliverStatus.kind}` : 'status info'}
          hidden={!deliverStatus}
        >
          {deliverStatus ? t(deliverStatus.key, deliverStatus.arg) : null}
        </p>
      </section>

      <section id="view-pair" hidden={view !== 'pair'}>
        <ol className="steps">
          <li>
            <h3>
              {t('step1Title')} <span className="muted small">{t('step1Note')}</span>
            </h3>
            <p className="muted small">{t('step1Drag')}</p>
            <p className="btnrow">
              <a
                id="bookmarklet"
                className="btn bookmarklet"
                href={bookmarkletHref}
                onClick={onBookmarkletClick}
              >
                {t('bookmarkletLabel')}
              </a>
              <button
                id="copy-bookmarklet"
                className="btn ghost"
                type="button"
                onClick={onCopyBookmarklet}
              >
                {copyLabel ? t(copyLabel) : t('copyBtn')}
              </button>
            </p>
            <p className="muted small">{t('step1Hint')}</p>
          </li>
          <li>
            <h3>{t('step2Title')}</h3>
            <p className="btnrow">
              <a
                className="btn"
                href="https://ontrack.infotech.monash.edu"
                target="_blank"
                rel="noopener"
              >
                {t('step2Btn')}
              </a>
            </p>
            <p className="muted small">{t('step2Hint')}</p>
          </li>
          <li>
            <h3>{t('step3Title')}</h3>
            <p className="muted small">{t('step3Body')}</p>
          </li>
        </ol>

        <div className="alt">
          <h3>{t('mobileTitle')}</h3>
          <p className="muted small">{t('mobileBody')}</p>
          <h3 style={{ marginTop: 16 }}>{t('altTitle')}</h3>
          <p className="muted small">{t('altHint')}</p>
          <form id="paste-form" onSubmit={onPasteSubmit}>
            <input
              id="paste-input"
              name="paste-url"
              type="url"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="https://ontrack.infotech.monash.edu/sign_in?authToken=…"
            />
            <button className="btn" type="submit">
              {t('pasteBtn')}
            </button>
          </form>
        </div>

        <p
          id="pair-status"
          className={pairStatus ? `status ${pairStatus.kind}` : 'status'}
          hidden={!pairStatus}
        >
          {pairStatus ? t(pairStatus.key, pairStatus.arg) : null}
        </p>
        <p className="muted small" style={{ marginTop: 18 }}>
          {t('codeLabel')}{' '}
          <span className="codechip">
            <span className="pulse" />
            <span id="code-display">{displayCode}</span>
          </span>
        </p>
        <p className="muted small">{t('codeNote')}</p>
      </section>
    </main>
  );
}
