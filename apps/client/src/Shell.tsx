import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameRuntime } from './runtime/GameRuntime';
import { claimPlayerId, getOrCreatePlayerId } from './runtime/playerId';
import { useConnection } from './runtime/connection';
import { Site } from './site/Site';
import { Curtain } from './site/Curtain';
import { TurnUpright } from './site/TurnUpright';
import {
  gameIfReady, loadGame, loadLocalRuntime, localRuntimeIfReady, loadSocketRuntime, openingIfChosen, stopPreloading,
} from './preload';
import { setBackstage } from './game/backstage';
import { useStageReady } from './game/stage';
import { signInState, useAudiotoolSession } from './audiotool/SignIn';
import { getAudiotoolSession } from './audiotool/sessionStore';
import { DEV_HANDLE } from './runtime/devFlag';

type GameComponent = typeof import('./Game').default;
type LocalRuntimeModule = typeof import('./runtime/LocalGameRuntime');

function unlockAudio() {
  void import('./audio/LoopEngine').then((module) => module.loopEngine.resume()).catch(() => {});
}

function frames(n: number) {
  return new Promise<void>((resolve) => {
    const step = (left: number) => requestAnimationFrame(() => (left <= 1 ? resolve() : step(left - 1)));
    step(n);
  });
}

export default function Shell() {
  const [session, setSession] = useState<GameRuntime | null>(null);
  const [standby, setStandby] = useState<GameRuntime | null>(null);
  const standbyRef = useRef(standby);
  standbyRef.current = standby;
  const [Game, setGame] = useState<GameComponent | null>(() => gameIfReady()?.default ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<'room' | 'solo' | null>(null);
  const initialCode = useMemo(() => readRoomFromUrl() || consumeOAuthReturnRoom(), []);
  const oauthReturnMode = useMemo(() => consumeOAuthReturnMode(), []);

  const [veil, setVeil] = useState<'enter' | 'leave' | null>(null);
  const [veilMode, setVeilMode] = useState<'enter' | 'leave'>('enter');
  const [covered, setCovered] = useState(false);
  const coverWaiters = useRef<Array<() => void>>([]);
  const coveredRef = useRef(false);
  const cover = (mode: 'enter' | 'leave') => new Promise<void>((resolve) => {
    setVeil(mode);
    setVeilMode(mode);
    if (coveredRef.current) resolve();
    else coverWaiters.current.push(resolve);
  });
  const onCovered = () => {
    coveredRef.current = true;
    setCovered(true);
    for (const resolve of coverWaiters.current.splice(0)) resolve();
  };
  const lower = () => {
    coveredRef.current = false;
    setCovered(false);
    setVeil(null);
  };
  const [entering, setEntering] = useState(false);
  const busyEntering = useRef(false);

  const auth = useAudiotoolSession();
  const signedIn = signInState(auth) === 'in' || DEV_HANDLE;

  useEffect(() => {
    if (session || busy || !signedIn) return;
    if (initialCode) void joinMultiplayer(initialCode, true);
    else if (oauthReturnMode === 'local') void startSolo();
  }, [signedIn]);

  const begin = (way: 'room' | 'solo') => {
    if (busyEntering.current) return false;
    busyEntering.current = true;
    unlockAudio();
    setPending(way);
    setBusy(true);
    setError('');
    setEntering(true);
    stopPreloading();
    return true;
  };

  const fail = (message: string) => {
    busyEntering.current = false;
    setError(message);
    setPending(null);
    setBusy(false);
    setEntering(false);
    lower();
  };

  function enter(stage: { default: GameComponent }, next: GameRuntime) {
    setBackstage(false);
    setGame(() => stage.default);
    setStandby(null);
    setSession(next);
    setBusy(false);
  }

  const startSolo = async () => {
    if (!begin('solo')) return;
    const modules = Promise.all([
      gameIfReady() ?? loadGame(),
      localRuntimeIfReady() ?? loadLocalRuntime(),
    ]);
    try {
      const [[stage, runtimeModule]] = await Promise.all([modules, cover('enter')]);
      enterPath('/');
      const waiting = standbyRef.current;
      if (waiting && isStartable(waiting)) {
        waiting.start();
        enter(stage, waiting);
        return;
      }
      enter(stage, new runtimeModule.LocalGameRuntime(getOrCreatePlayerId(), playerName(), { opening: openingIfChosen() ?? undefined }));
    } catch (e) { fail(toMessage(e)); }
  };

  const warmRoom = () => {
    if (session) return;
    void loadSocketRuntime().then((module) => module.warmConnection()).catch(() => undefined);
  };
  useEffect(() => { if (initialCode) warmRoom(); }, []);

  const createMultiplayer = async () => {
    if (!begin('room')) return;
    const stage = gameIfReady() ?? loadGame();
    try {
      const { SocketGameRuntime } = await loadSocketRuntime();
      const prepared = standbyRef.current?.getState() ?? openingIfChosen();
      const [next, loaded] = await Promise.all([
        SocketGameRuntime.create({
          playerKey: await claimPlayerId(), playerName: playerName(), themeId: prepared?.themeId, runSeed: prepared?.runSeed,
        }),
        stage,
        cover('enter'),
      ]);
      enterPath(`/room/${next.roomCode}`);
      enter(loaded, next);
    } catch (e) { fail(toMessage(e)); }
  };

  async function joinMultiplayer(code: string, automatic = false) {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;
    if (!begin('room')) return;
    try {
      const { SocketGameRuntime } = await loadSocketRuntime();
      const prepared = automatic ? standbyRef.current?.getState() ?? openingIfChosen() : null;
      const next = await SocketGameRuntime.join({
        code: cleanCode, playerKey: await claimPlayerId(), playerName: playerName(),
        create: automatic, themeId: prepared?.themeId, runSeed: prepared?.runSeed,
      });
      const [loaded] = await Promise.all([gameIfReady() ?? loadGame(), cover('enter')]);
      enterPath(`/room/${next.roomCode}`);
      enter(loaded, next);
    } catch (e) {
      fail(`${toMessage(e)}${automatic ? ' You can still play completely offline.' : ''}`);
      if (automatic) replacePath(`/join/${cleanCode}`);
    }
  }

  const leaving = useRef(false);
  const leave = async (fromHistory = false) => {
    if (!fromHistory || /^\/(?:room|join)\//.test(window.location.pathname)) replacePath('/');
    if (leaving.current) return;
    leaving.current = true;
    await cover('leave');
    busyEntering.current = false;
    setPending(null);
    setBusy(false);
    setEntering(false);
    const runtimeModule = localRuntimeIfReady();
    setBackstage(true);
    setStandby(runtimeModule ? makeStandby(runtimeModule) : null);
    setSession(null);
    await frames(4);
    leaving.current = false;
    lower();
  };

  const liveRef = useRef(false);
  liveRef.current = session !== null;
  useEffect(() => {
    const onPop = () => {
      if (liveRef.current && !isShowEntry(history.state)) void leave(true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const requestLeave = () => {
    if (isShowEntry(history.state)) history.back();
    else void leave();
  };

  const closedReason = useConnection((connection) => connection.status === 'closed' ? connection.reason : null);
  useEffect(() => {
    if (!closedReason || !session || session.mode !== 'socket') return;
    const code = session.roomCode;
    void leave();
    if (code) replacePath(`/join/${code}`);
    setError(closedReason);
  }, [closedReason]);

  const live = session !== null;
  const runtime = session ?? standby;
  const stageReady = useStageReady((store) => store.ready);
  useEffect(() => {
    if (veil !== 'enter' || !live || !stageReady) return;
    busyEntering.current = false;
    setEntering(false);
    lower();
  }, [veil, live, stageReady]);
  useEffect(() => (live ? refusePinch() : undefined), [live]);
  const siteShown = !live && !(entering && covered);

  return (
    <>
      {Game && runtime && <Game runtime={runtime} onLeave={requestLeave} backstage={!live} />}
      {siteShown && (
        <Site
          busy={busy || entering}
          pending={pending}
          error={error}
          onCreate={() => void createMultiplayer()}
          onSolo={() => void startSolo()}
          onJoin={(code: string) => void joinMultiplayer(code)}
          onRoomIntent={warmRoom}
        />
      )}
      <Curtain
        up={veil !== null}
        mode={veilMode}
        onCovered={onCovered}
        joining={pending === 'room'}
        codeReady={Game !== null}
        roomReady={session !== null}
      />
      {live && <TurnUpright />}
    </>
  );
}

function refusePinch() {
  const refuse = (event: Event) => event.preventDefault();
  const twoFingers = (event: TouchEvent) => { if (event.touches.length > 1) event.preventDefault(); };
  const gestures = ['gesturestart', 'gesturechange', 'gestureend'];
  for (const type of gestures) document.addEventListener(type, refuse, { passive: false });
  document.addEventListener('touchmove', twoFingers, { passive: false });
  return () => {
    for (const type of gestures) document.removeEventListener(type, refuse);
    document.removeEventListener('touchmove', twoFingers);
  };
}

function makeStandby(runtimeModule: LocalRuntimeModule): GameRuntime {
  return new runtimeModule.LocalGameRuntime(getOrCreatePlayerId(), playerName(), { standby: true });
}

type Startable = GameRuntime & { start: () => void };
const isStartable = (runtime: GameRuntime): runtime is Startable =>
  runtime.mode === 'local' && typeof (runtime as Startable).start === 'function';

function playerName() {
  const session = getAudiotoolSession();
  return session.displayName ?? `Player ${10 + (parseInt(getOrCreatePlayerId().slice(0, 6), 16) % 90)}`;
}

try { localStorage.removeItem('loop-player-name'); } catch {}

function replacePath(path: string) {
  history.replaceState({}, '', `${path}${window.location.search}`);
}

const SHOW_ENTRY = { keepTheBeat: 'show' } as const;
const isShowEntry = (state: unknown) => (state as { keepTheBeat?: string } | null)?.keepTheBeat === SHOW_ENTRY.keepTheBeat;

function enterPath(path: string) {
  if (isShowEntry(history.state)) replacePathAs(path, SHOW_ENTRY);
  else history.pushState(SHOW_ENTRY, '', `${path}${window.location.search}`);
}

function replacePathAs(path: string, state: unknown) {
  history.replaceState(state, '', `${path}${window.location.search}`);
}

function readRoomFromUrl() {
  const match = window.location.pathname.match(/^\/(?:join|room)\/([A-Za-z0-9]{4})/);
  return match?.[1]?.toUpperCase() ?? null;
}

function consumeOAuthReturnRoom() {
  const room = localStorage.getItem('loop-return-room');
  if (room) localStorage.removeItem('loop-return-room');
  return room;
}

function consumeOAuthReturnMode() {
  const mode = localStorage.getItem('loop-return-mode');
  if (mode) localStorage.removeItem('loop-return-mode');
  return mode;
}

function toMessage(value: unknown) { return value instanceof Error ? value.message : String(value); }
