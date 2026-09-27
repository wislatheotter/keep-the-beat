import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { CHALLENGES, CHALLENGES_URL, HACKATHON_URL } from './links';
import { Icon } from '../overlay/icons';
import { SignInNote, SignInPanel, SignedInAs, Swap } from './SignInPanel';
import { beginSignIn, signInState, useAudiotoolSession } from '../audiotool/SignIn';
import { DEV_HANDLE } from '../runtime/devFlag';
import { useLayoutMotion } from './useLayoutMotion';
import { Video } from './Video';

export type HomeProps = {
  busy: boolean;
  pending?: 'room' | 'solo' | null;
  error: string;
  onCreate: () => void;
  onSolo: () => void;
  onJoin: (code: string) => void;
  onRoomIntent?: () => void;
};

const CODE_LENGTH = 4;
const AUTO_JOIN_DELAY_MS = 350;

export function Home({ busy, pending = null, error, onCreate, onSolo, onJoin, onRoomIntent }: HomeProps) {
  const [code, setCode] = useState(() => window.location.pathname.match(/^\/(?:join|room)\/([A-Za-z0-9]{4})/)?.[1]?.toUpperCase() ?? '');
  const session = useAudiotoolSession();
  const signedIn = signInState(session) === 'in';
  const canPlay = signedIn || DEV_HANDLE;
  const complete = code.length === CODE_LENGTH;

  const signIn = () => beginSignIn(session);
  const copy = useRef<HTMLDivElement>(null);
  useLayoutMotion(copy);

  const join = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || busy) return;
    tried.current = code;
    onJoin(code);
  };

  const typed = useRef(false);
  const tried = useRef(code);
  const joinRef = useRef(onJoin);
  joinRef.current = onJoin;
  useEffect(() => {
    if (!typed.current || !complete || busy || tried.current === code) return;
    const timer = window.setTimeout(() => {
      tried.current = code;
      joinRef.current(code);
    }, AUTO_JOIN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [code, complete, busy]);

  return (
    <>
      <section className="hero">
        <div className="hero-copy" ref={copy}>
          <h1 className="display">
            Keep
            <br />
            the
            <br />
            beat<span className="dot">.</span>
          </h1>

          <p className="lead">
            A party game for making music with friends, no skills required. Everyone who played can
            take the track home as an Audiotool project.
          </p>

          {!signedIn && <SignInPanel session={session} onSignIn={signIn} />}

          {canPlay && (
            <div className="cta">
              <button
                type="button"
                className="btn btn-accent"
                disabled={busy}
                onClick={onCreate}
                onPointerEnter={onRoomIntent}
                onPointerDown={onRoomIntent}
                onFocus={onRoomIntent}
              >
                <Swap text={pending === 'room' ? 'Connecting…' : 'Start a room'} /> <Icon name="next" />
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={onSolo}>
                <Swap text={pending === 'solo' ? 'Starting…' : 'Play solo'} /> <Icon name="next" />
              </button>
              <form className="join" onSubmit={join} data-complete={complete ? '' : undefined}>
                <input
                  id="room-code"
                  value={code}
                  placeholder="Room code"
                  inputMode="text"
                  enterKeyHint="go"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={CODE_LENGTH}
                  aria-label="Room code"
                  onFocus={onRoomIntent}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    typed.current = true;
                    setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH));
                    onRoomIntent?.();
                  }}
                />
                <button type="submit" disabled={busy || !complete} aria-label="Join room">
                  <Icon name="next" />
                </button>
              </form>
            </div>
          )}

          {signedIn ? <SignedInAs session={session} /> : <SignInNote session={session} />}

          {error && (
            <p className="site-error">
              <span>{error}</span>
              <button type="button" onClick={onSolo}>
                Play offline instead
              </button>
            </p>
          )}
        </div>

        <figure className="hero-art" aria-hidden="true">
          <img className="hero-crew" src="/homepage/hero-crew.png" alt="" width={1100} height={800} />
          <img className="hero-record" src="/homepage/hero-record.webp" alt="" width={360} height={366} />
        </figure>
      </section>

      <Video />

      <section className="hack">
        <p className="kicker">Audiotool · Let’s Build 2026</p>
        <p>
          Built for{' '}
          <a href={HACKATHON_URL} target="_blank" rel="noreferrer">
            Let’s Build
          </a>
          , Audiotool’s hackathon.
        </p>
        <div className="entered">
          <span id="entered-in">Entered in</span>
          <ul className="challenges" aria-labelledby="entered-in">
            {CHALLENGES.map((name) => (
              <li key={name}>
                <a href={CHALLENGES_URL} target="_blank" rel="noreferrer">{name}</a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
