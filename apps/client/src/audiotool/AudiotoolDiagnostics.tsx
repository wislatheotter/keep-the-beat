import { useEffect, useState } from 'react';
import { getAudiotoolSession, startAudiotoolAuth, subscribeAudiotoolSession, type AudiotoolAuthSession } from './authSession';

export function AudiotoolDiagnosticsPanel() {
  const [session, setSession] = useState<AudiotoolAuthSession>(() => getAudiotoolSession());
  useEffect(() => {
    void startAudiotoolAuth();
    return subscribeAudiotoolSession(setSession);
  }, []);

  const forced = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'audiotool';
  if (!import.meta.env.DEV && !forced) return null;

  const d = session.diagnostics;
  const rows: Array<[string, string, boolean?]> = [
    ['status', d.status],
    ['origin', d.origin],
    ['redirect URI', d.redirectUri || '(none)'],
    ['origin matches', d.redirectOriginMatches ? 'yes' : 'NO — a login cannot return here', !d.redirectOriginMatches],
    ['client id', `${d.clientIdMasked || '(unset)'} · from ${d.clientIdSource}`, d.clientIdSource === 'none'],
    ['scope', d.scope],
    ['OAuth code seen', `${d.sawOAuthCode ? 'yes' : 'no'}${d.restoredOAuthParams ? ' (restored after routing)' : ''}`],
    ['OAuth error seen', d.sawOAuthError ? 'yes' : 'no', d.sawOAuthError],
    ['user', d.userName ?? '—'],
    ['client', d.clientAvailable ? 'available' : 'none'],
    ['error', d.error ?? '—', Boolean(d.error)],
  ];

  return (
    <details className="audiotool-diagnostics">
      <summary>Audiotool diagnostics · {d.status}</summary>
      <dl>
        {rows.map(([label, value, bad]) => (
          <div key={label} className={bad ? 'bad' : undefined}>
            <dt>{label}</dt><dd>{value}</dd>
          </div>
        ))}
      </dl>
      {session.login && <button className="chip" onClick={() => session.login?.()}>Start Audiotool login</button>}
      {session.logout && <button className="chip" onClick={() => session.logout?.()}>Log out</button>}
    </details>
  );
}
