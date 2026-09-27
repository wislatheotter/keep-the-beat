import { audiotool, type AuthenticatedClient } from '@audiotool/nexus';
import { BOOT_PARAMS } from './bootSearch';
import {
  AUDIOTOOL_SCOPE,
  getAudiotoolSession,
  updateAudiotoolSession as update,
  type AudiotoolAuthSession,
  type AudiotoolDiagnostics,
} from './sessionStore';

const OAUTH_PARAMS = ['code', 'state', 'scope', 'error', 'error_description'] as const;

const bootParams = BOOT_PARAMS;
const bootHadCode = bootParams.has('code');
const bootHadError = bootParams.has('error');

export {
  AUDIOTOOL_SCOPE,
  getAudiotoolSession,
  subscribeAudiotoolSession,
  type AudiotoolAuthSession,
  type AudiotoolAuthStatus,
  type AudiotoolDiagnostics,
} from './sessionStore';

export const DEFAULT_CLIENT_ID = '715b0090-bc5e-4d9c-b815-62a427266c1c';

type PublicConfig = { audiotoolClientId: string; audiotoolRedirectUri?: string };

function mask(value: string) {
  if (!value) return '';
  if (value.length <= 10) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function defaultRedirectUri() {
  if (import.meta.env.DEV) return `http://127.0.0.1:${window.location.port || '5173'}/`;
  return `${window.location.origin}/`;
}

async function fetchPublicConfig(): Promise<PublicConfig | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch('/api/config', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as PublicConfig;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function restoreOAuthParams(): boolean {
  if (!bootHadCode && !bootHadError) return false;
  const current = new URL(window.location.href);
  if (OAUTH_PARAMS.some((key) => current.searchParams.has(key))) return false;
  for (const key of OAUTH_PARAMS) {
    const value = bootParams.get(key);
    if (value !== null) current.searchParams.set(key, value);
  }
  window.history.replaceState({}, document.title, current.toString());
  return true;
}

let started: Promise<AudiotoolAuthSession> | null = null;

export function startAudiotoolAuth(): Promise<AudiotoolAuthSession> {
  started ??= run();
  return started;
}

async function run(): Promise<AudiotoolAuthSession> {
  const origin = window.location.origin;
  const buildClientId = import.meta.env.VITE_AUDIOTOOL_CLIENT_ID?.trim() ?? '';
  const buildRedirect = import.meta.env.VITE_AUDIOTOOL_REDIRECT_URI?.trim() ?? '';

  update({ status: 'configuring' }, { origin });

  const runtimeConfig = await fetchPublicConfig();
  const configClientId = runtimeConfig?.audiotoolClientId?.trim() ?? '';
  const clientId = buildClientId || configClientId || DEFAULT_CLIENT_ID;
  const clientIdSource: AudiotoolDiagnostics['clientIdSource'] =
    buildClientId ? 'build-env' : configClientId ? 'api-config' : DEFAULT_CLIENT_ID ? 'built-in' : 'none';
  const redirectUri = buildRedirect || runtimeConfig?.audiotoolRedirectUri?.trim() || defaultRedirectUri();

  let redirectOriginMatches = false;
  try {
    redirectOriginMatches = new URL(redirectUri).origin === origin;
  } catch {
    redirectOriginMatches = false;
  }

  const baseDiagnostics: Partial<AudiotoolDiagnostics> = {
    origin,
    redirectUri,
    redirectOriginMatches,
    clientIdMasked: mask(clientId),
    clientIdSource,
  };

  if (!clientId) {
    update({
      status: 'unconfigured',
      error: 'No Audiotool client id. Set AUDIOTOOL_CLIENT_ID (server) or VITE_AUDIOTOOL_CLIENT_ID (client).',
    }, baseDiagnostics);
    return getAudiotoolSession();
  }

  if (!redirectOriginMatches) {
    update({
      status: 'origin-mismatch',
      error: `This page is on ${origin}, but the registered redirect URI is ${redirectUri}. Audiotool login only works from that origin.`,
    }, baseDiagnostics);
    return getAudiotoolSession();
  }

  const restored = restoreOAuthParams();
  update({ status: 'connecting' }, { ...baseDiagnostics, restoredOAuthParams: restored });

  try {
    const result = await audiotool({ clientId, redirectUrl: redirectUri, scope: AUDIOTOOL_SCOPE });
    if (result.status === 'authenticated') {
      update({
        status: 'authenticated',
        client: result,
        userName: result.userName ?? null,
        displayName: null,
        error: null,
        login: null,
        logout: () => result.logout(),
      }, baseDiagnostics);
      void lookUpDisplayName(result);
    } else {
      update({
        status: result.error ? 'error' : 'unauthenticated',
        client: null,
        userName: null,
        displayName: null,
        error: result.error ? result.error.message : null,
        login: () => result.login(),
        logout: null,
      }, baseDiagnostics);
    }
  } catch (error) {
    update({
      status: 'error',
      client: null,
      userName: null,
      displayName: null,
      error: error instanceof Error ? error.message : String(error),
      login: null,
      logout: null,
    }, baseDiagnostics);
  }

  return getAudiotoolSession();
}

async function lookUpDisplayName(client: AuthenticatedClient) {
  if (!client.userName) return;
  try {
    const response = await client.users.getUser({ name: client.userName });
    if (response instanceof Error) return;
    const name = response.user?.displayName.trim();
    if (name && getAudiotoolSession().client === client) update({ displayName: name });
  } catch {
  }
}
