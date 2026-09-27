import type { AuthenticatedClient } from '@audiotool/nexus';
import { BOOT_PARAMS } from './bootSearch';

export type AudiotoolAuthStatus =
  | 'idle'
  | 'configuring'
  | 'unconfigured'
  | 'origin-mismatch'
  | 'connecting'
  | 'authenticated'
  | 'unauthenticated'
  | 'error';

export type AudiotoolAuthSession = {
  status: AudiotoolAuthStatus;
  client: AuthenticatedClient | null;
  userName: string | null;
  displayName: string | null;
  error: string | null;
  login: (() => void) | null;
  logout: (() => void) | null;
  diagnostics: AudiotoolDiagnostics;
};

export type AudiotoolDiagnostics = {
  origin: string;
  redirectUri: string;
  redirectOriginMatches: boolean;
  clientIdMasked: string;
  clientIdSource: 'build-env' | 'api-config' | 'built-in' | 'none';
  scope: string;
  sawOAuthCode: boolean;
  sawOAuthError: boolean;
  restoredOAuthParams: boolean;
  status: AudiotoolAuthStatus;
  error: string | null;
  userName: string | null;
  clientAvailable: boolean;
};

export const AUDIOTOOL_SCOPE = 'project:write project:read offline';

const listeners = new Set<(session: AudiotoolAuthSession) => void>();

let session: AudiotoolAuthSession = {
  status: 'idle',
  client: null,
  userName: null,
  displayName: null,
  error: null,
  login: null,
  logout: null,
  diagnostics: {
    origin: typeof window === 'undefined' ? '' : window.location.origin,
    redirectUri: '',
    redirectOriginMatches: false,
    clientIdMasked: '',
    clientIdSource: 'none',
    scope: AUDIOTOOL_SCOPE,
    sawOAuthCode: BOOT_PARAMS.has('code'),
    sawOAuthError: BOOT_PARAMS.has('error'),
    restoredOAuthParams: false,
    status: 'idle',
    error: null,
    userName: null,
    clientAvailable: false,
  },
};

export function getAudiotoolSession() {
  return session;
}

export function subscribeAudiotoolSession(listener: (session: AudiotoolAuthSession) => void) {
  listeners.add(listener);
  listener(session);
  return () => { listeners.delete(listener); };
}

export function updateAudiotoolSession(
  patch: Partial<AudiotoolAuthSession>,
  diagnosticsPatch: Partial<AudiotoolDiagnostics> = {},
) {
  const next = { ...session, ...patch };
  next.diagnostics = {
    ...session.diagnostics,
    ...diagnosticsPatch,
    status: next.status,
    error: next.error,
    userName: next.userName,
    clientAvailable: next.client !== null,
  };
  session = next;
  for (const listener of listeners) listener(session);
}
