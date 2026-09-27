import { useEffect, useState } from 'react';
import {
  getAudiotoolSession,
  subscribeAudiotoolSession,
  type AudiotoolAuthSession,
} from './sessionStore';

export function useAudiotoolSession(): AudiotoolAuthSession {
  const [session, setSession] = useState(getAudiotoolSession);
  useEffect(() => {
    void import('./authSession').then((module) => module.startAudiotoolAuth());
    return subscribeAudiotoolSession(setSession);
  }, []);
  return session;
}

export function beginSignIn(session: AudiotoolAuthSession) {
  const match = window.location.pathname.match(/^\/(?:join|room)\/([A-Za-z0-9]{4})/);
  if (match) localStorage.setItem('loop-return-room', match[1]!.toUpperCase());
  session.login?.();
}

export const displayName = (userName: string | null) => userName?.replace(/^users\//, '') ?? null;

export function AudiotoolMark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20.84 24a3.156 3.156 0 0 1-2.772-1.646A11.95 11.95 0 0 1 12 24C5.37 24 0 18.625 0 11.998 0 5.371 5.37 0 12 0s12 5.371 12 12.002v8.842A3.157 3.157 0 0 1 20.844 24m-8.84-17.683a5.685 5.685 0 0 0-5.685 5.685 5.68 5.68 0 0 0 5.685 5.681 5.682 5.682 0 0 0 5.684-5.681 5.685 5.685 0 0 0-5.684-5.685Z"
      />
    </svg>
  );
}

export type SignInState = 'working' | 'ready' | 'in' | 'blocked' | 'failed';

export function signInState(session: AudiotoolAuthSession): SignInState {
  switch (session.status) {
    case 'idle':
    case 'configuring':
    case 'connecting':
      return 'working';
    case 'authenticated':
      return 'in';
    case 'origin-mismatch':
    case 'unconfigured':
      return 'blocked';
    case 'error':
      return 'failed';
    case 'unauthenticated':
      return 'ready';
  }
}
