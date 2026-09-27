import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import {
  cleanPlayerName,
  runKey,
  sample as gameSample,
  songLengthBars,
  songRegions,
  theme,
  type GameState,
} from '@loop/shared';
import { useGameRuntime, useGameState } from '../runtime/GameRuntimeContext';
import type { AuthenticatedClient } from '@audiotool/nexus';
import {
  getAudiotoolSession,
  startAudiotoolAuth,
  subscribeAudiotoolSession,
  type AudiotoolAuthSession,
  type AudiotoolDiagnostics,
} from './authSession';
import { AudiotoolDiagnosticsPanel } from './AudiotoolDiagnostics';
import { writeSong } from './exportSong';
import { openExportTab } from './exportTab';
import { coverUrlFor } from '../game/cover';

type Status = 'disabled' | 'loading' | 'unauthenticated' | 'authenticated' | 'project-ready' | 'error';

type AudiotoolContextValue = {
  configured: boolean;
  status: Status;
  userName: string | null;
  projectUrl: string | null;
  message: string;
  diagnostics: AudiotoolDiagnostics;
  canLogin: boolean;
  canExport: boolean;
  exporting: boolean;
  connect(): Promise<void>;
  exportShow(): Promise<void>;
};

const Context = createContext<AudiotoolContextValue | null>(null);

const PAGE_SIZE = 100;

const WRITE_TIMEOUT_MS = 90_000;

function deadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export const STUDIO_URL = 'https://www.audiotool.com/studio';

export const studioUrl = (projectId: string) => `${STUDIO_URL}?project=${encodeURIComponent(projectId)}`;

function reason(error: unknown): string {
  let inner = error;
  while (inner instanceof Error && inner.cause instanceof Error) inner = inner.cause;
  return inner instanceof Error ? inner.message : String(inner);
}

export async function freeProjectName(client: AuthenticatedClient, base: string): Promise<string> {
  const taken = new Set<string>();
  try {
    let pageToken = '';
    for (let page = 0; page < 20; page += 1) {
      const response = await client.projects.listProjects({ pageSize: PAGE_SIZE, pageToken });
      if (response instanceof Error) break;
      for (const project of response.projects) taken.add(project.displayName);
      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }
  } catch {
    return base;
  }
  if (!taken.has(base)) return base;
  for (let n = 1; n < 1000; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${new Date().toISOString().slice(0, 19).replace('T', ' ')})`;
}

function describe(session: AudiotoolAuthSession): { status: Status; message: string } {
  switch (session.status) {
    case 'idle':
    case 'configuring':
    case 'connecting':
      return { status: 'loading', message: 'Preparing Audiotool…' };
    case 'unconfigured':
      return { status: 'disabled', message: 'Audiotool export is unavailable in this deployment.' };
    case 'origin-mismatch':
      return {
        status: 'disabled',
        message: `Audiotool only accepts a sign-in from ${session.diagnostics.redirectUri}. Open the game there.`,
      };
    case 'unauthenticated':
      return {
        status: 'unauthenticated',
        message: 'Sign in to keep this show as a real Audiotool project.',
      };
    case 'authenticated':
      return { status: 'authenticated', message: `Connected${session.userName ? ` as ${session.userName}` : ''}.` };
    case 'error':
      return { status: 'error', message: `Audiotool login failed: ${session.error ?? 'unknown error'}` };
  }
}

export { songRegions };

export function AudiotoolProvider({ children }: PropsWithChildren) {
  const runtime = useGameRuntime();
  const gameState = useGameState();

  const [session, setSession] = useState<AudiotoolAuthSession>(() => getAudiotoolSession());
  const [projectMessage, setProjectMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [projectUrl, setProjectUrl] = useState<string | null>(null);
  const latestGame = useRef<GameState>(gameState);

  useEffect(() => { latestGame.current = gameState; }, [gameState]);
  useEffect(() => {
    void startAudiotoolAuth();
    return subscribeAudiotoolSession(setSession);
  }, []);

  const myName = session.status === 'authenticated' ? session.displayName : null;
  const seated = gameState.players[runtime.playerId];
  const seatedSince = seated?.joinedAt;
  const nameToSeat = myName ? cleanPlayerName(myName) : '';
  const renamed = nameToSeat !== '' && seated !== undefined && seated.name !== nameToSeat;
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (seatedSince === undefined || myName === null) return;
    const said = [runtime.playerId, seatedSince, myName].join('|');
    if (said === told.current && !renamed) return;
    told.current = said;
    runtime.dispatch({ type: 'SET_AUDIOTOOL_USER', playerId: runtime.playerId, displayName: myName, now: runtime.now() });
  }, [runtime, seatedSince, myName, renamed]);

  const onResults = gameState.phase === 'complete';
  useEffect(() => {
    if (onResults) return;
    setProjectMessage(null);
    setProjectUrl(null);
  }, [onResults]);

  const connect = useCallback(async () => {
    if (!session.login) return;
    localStorage.setItem('loop-return-mode', runtime.mode);
    if (runtime.roomCode) localStorage.setItem('loop-return-room', runtime.roomCode);
    session.login();
  }, [session, runtime.mode, runtime.roomCode]);

  const exportShow = useCallback(async () => {
    const client = session.client;
    if (!client || exporting || projectUrl) return;

    const tab = openExportTab();
    const coverNow = coverUrlFor(latestGame.current.completedAt);
    if (coverNow) tab?.cover(coverNow);

    setExporting(true);
    setProjectMessage('Creating the Audiotool project…');
    try {
      const game = latestGame.current;
      const kit = theme(game.themeId);
      const regions = songRegions(game.song.committed);
      const finalBar = songLengthBars(game.song.committed);
      if (regions.length === 0) throw new Error('Nothing was committed, so there is nothing to export.');

      const displayName = await freeProjectName(client, `Keep the Beat — ${kit.label}`);
      const response = await client.projects.createProject({ project: { displayName, bpm: kit.bpm } });
      if (response instanceof Error) throw response;
      const project = response.project;
      if (!project?.name) throw new Error('Audiotool did not return a project name.');

      tab?.name(displayName);
      tab?.step('write');
      const doc = await client.open(project.name);
      await doc.start();
      let failure: unknown = null;
      try {
        await deadline(
          doc.modify((t) => {
            try {
              writeSong(t, regions, (name) => gameSample(name, kit.id), kit.bpm, runKey(game.themeId, game.runSeed));
            } catch (error) {
              failure = error;
              throw error;
            }
          }),
          WRITE_TIMEOUT_MS,
          'Writing the project took too long. Nothing of yours was changed.',
        );
      } finally {
        if (failure) throw failure;
        await deadline(doc.stop(), WRITE_TIMEOUT_MS, 'Closing the project took too long.').catch(() => {});
      }

      const url = studioUrl(project.name.split('/').pop() ?? project.name);
      setProjectUrl(url);
      setProjectMessage(`Exported as “${displayName}” — ${game.song.committed.length} sections, ${regions.length} regions, ${finalBar} bars.`);
      tab?.go(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[audiotool] export failed:', reason(error), error);
      setProjectMessage(`Audiotool export failed: ${message}`);
      tab?.fail();
    } finally {
      setExporting(false);
    }
  }, [session.client, exporting, projectUrl]);

  const value = useMemo<AudiotoolContextValue>(() => {
    const described = describe(session);
    const status: Status = projectUrl && described.status === 'authenticated' ? 'project-ready' : described.status;
    return {
      configured: session.status !== 'unconfigured',
      status,
      userName: session.userName,
      projectUrl,
      message: projectMessage ?? described.message,
      diagnostics: session.diagnostics,
      canLogin: session.login !== null,
      canExport: session.client !== null && !projectUrl,
      exporting,
      connect,
      exportShow,
    };
  }, [session, projectUrl, projectMessage, exporting, connect, exportShow]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAudiotool() {
  const value = useContext(Context);
  if (!value) throw new Error('useAudiotool must be inside AudiotoolProvider');
  return value;
}

export function AudiotoolPanel({ compact = false }: { compact?: boolean }) {
  const at = useAudiotool();
  const [open, setOpen] = useState(false);

  if (compact) {
    if (at.status === 'disabled') return null;
    return (
      <div className="audiotool-compact">
        <button onClick={() => setOpen((value) => !value)} className={`integration-dot ${at.status}`}>AT</button>
        {open && <div className="integration-popover"><strong>Audiotool</strong><p>{at.message}</p><IntegrationActions at={at} /></div>}
      </div>
    );
  }

  if (at.status === 'disabled') {
    return <div className="notice-card"><strong>Audiotool</strong><p>{at.message}</p><AudiotoolDiagnosticsPanel /></div>;
  }

  return (
    <div className="integration-card">
      <div><span className={`status-dot ${at.status}`} /><strong>Audiotool</strong><p>{at.message}</p></div>
      <IntegrationActions at={at} />
      <AudiotoolDiagnosticsPanel />
    </div>
  );
}

function IntegrationActions({ at }: { at: AudiotoolContextValue }) {
  if (at.status === 'loading') return <button className="secondary-button" disabled>Loading…</button>;
  if (at.status === 'unauthenticated' && at.canLogin) return <button className="primary-button" onClick={() => void at.connect()}>Connect Audiotool</button>;
  if (at.status === 'error') return <button className="secondary-button" onClick={() => window.location.reload()}>Retry</button>;
  if (at.projectUrl) return <button className="secondary-button" onClick={() => window.open(at.projectUrl!, '_blank', 'noopener,noreferrer')}>Open Audiotool ↗</button>;
  if (at.status === 'authenticated' || at.status === 'project-ready') return <div className="integration-ready"><span>✓</span> Connected</div>;
  return null;
}
