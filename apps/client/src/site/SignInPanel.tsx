import { AudiotoolMark, displayName, signInState, type SignInState } from '../audiotool/SignIn';
import type { AudiotoolAuthSession } from '../audiotool/sessionStore';
import { AUDIOTOOL_SECTION } from './Privacy';
import { Link, PATHS } from './router';

export function SignInPanel({ session, onSignIn }: { session: AudiotoolAuthSession; onSignIn: () => void }) {
  const state = signInState(session);

  if (state === 'blocked') {
    const home = registeredOrigin(session);
    return (
      <div className="gate">
        <button
          type="button"
          className="btn btn-audiotool"
          disabled={!home}
          onClick={() => home && window.location.assign(`${home}${window.location.pathname}${window.location.search}`)}
        >
          <span className="btn-at-label">
            <AudiotoolMark size={26} />
            <Swap text={home ? LABEL.ready : LABEL.blocked} />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="gate">
      <button
        type="button"
        className="btn btn-audiotool"
        disabled={state !== 'ready'}
        onClick={onSignIn}
      >
        <span className="btn-at-label">
          <AudiotoolMark size={26} />
          <Swap text={LABEL[state]} />
        </span>
      </button>
    </div>
  );
}

export function SignInNote({ session }: { session: AudiotoolAuthSession }) {
  const state = signInState(session);
  if (state === 'blocked') return null;
  return (
    <div className="gate">
      {state === 'failed' && (
        <p className="gate-error">
          {session.error} <button type="button" onClick={() => window.location.reload()}>Try again</button>
        </p>
      )}
      <p className="gate-note">
        The game reads your username and only ever adds a new project, when you export.{' '}
        <Link to={`${PATHS.privacy}#${AUDIOTOOL_SECTION}`}>Privacy</Link>
      </p>
    </div>
  );
}

export function Swap({ text }: { text: string }) {
  return <span key={text} data-swap="">{text}</span>;
}

function registeredOrigin(session: AudiotoolAuthSession): string | null {
  if (session.status !== 'origin-mismatch') return null;
  try {
    return new URL(session.diagnostics.redirectUri).origin;
  } catch {
    return null;
  }
}

const LABEL: Record<SignInState, string> = {
  working: 'Connecting to Audiotool…',
  ready: 'Sign in with Audiotool',
  in: 'Signed in',
  blocked: 'Sign-in unavailable here',
  failed: 'Sign-in failed',
};

export function SignedInAs({ session }: { session: AudiotoolAuthSession }) {
  const name = displayName(session.userName);
  return (
    <p className="signed-in">
      <AudiotoolMark size={16} />
      <span>
        Signed in as <strong>{name ?? 'your Audiotool account'}</strong>
      </span>
      {session.logout && (
        <button type="button" onClick={() => session.logout?.()}>
          Sign out
        </button>
      )}
    </p>
  );
}
