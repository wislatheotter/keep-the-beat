import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import {
  FX_IDS,
  LOB_POWER_MAX,
  LOB_POWER_MIN,
  SHOW_INTRO_MS,
  THEME_IDS,
  barDurationMs,
  lobbyForecast,
  loopPlan,
  mixSignature,
  openingManifest,
  openingRecord,
  predictMix,
  rackContents,
  replayClock,
  replayPassStartsAt,
  runKey,
  songRegions,
  stockForecast,
  theme,
  type GameEvent,
  type GameSample,
  type GameState,
  type Gesture,
  type MixReading,
  type SongRegion,
} from '@loop/shared';
import { create } from 'zustand';
import { loopEngine, type CueKind } from './LoopEngine';
import type { Foley } from './foley';
import { sampleLibrary, type PrepareProgress } from '../audiotool/sampleLibrary';
import { mayPrefetch } from '../audiotool/sampleUrls';
import { useGameRuntime, useGameState } from '../runtime/GameRuntimeContext';
import { DEV_HANDLE } from '../runtime/devFlag';
import { useStageReady } from '../game/stage';
import { useBackstage } from '../game/backstage';
import { useAimStore } from '../game/aim';

export type ShowAudioStatus = {
  unlocked: boolean;
  preparing: boolean;
  progress: PrepareProgress;
  failed: string[];
  prefetched: number;
};

export const useShowAudioStatus = create<ShowAudioStatus>(() => ({
  unlocked: false,
  preparing: true,
  progress: { total: 0, ready: 0, failed: 0, current: null },
  failed: [],
  prefetched: 0,
}));

const setStatus = (status: Partial<ShowAudioStatus>) => useShowAudioStatus.setState(status);

type ShowAudioValue = {
  unlock: () => Promise<void>;
  blip: (kind: CueKind) => void;
  stopPlayback: () => void;
  mixReading: () => (MixReading & { signature: string }) | null;
};

const Context = createContext<ShowAudioValue | null>(null);

function blipFor(event: GameEvent): CueKind | null {
  switch (event.type) {
    case 'overtime': return 'alarm';
    case 'song-complete': return 'finish';
    default: return null;
  }
}

const GESTURE_FOLEY: Partial<Record<Gesture, Foley>> = {
  'grab-high': 'take',
  grab: 'pickup',
  catch: 'pickup',
  eject: 'pickup',
  drop: 'floor',
  lob: 'throw',
  place: 'seat',
  feed: 'feed',
};

const OTHERS_LEVEL = 0.3;

type HandMemory = {
  gestures: Map<string, number>;
  flying: Map<string, string | null>;
  touched: Map<string, string>;
  machines: Map<string, string | null>;
  processed: string | null;
};

function handSounds(state: GameState, now: number, localId: string, memory: HandMemory) {
  const level = (playerId: string | null | undefined) => (playerId === localId ? 1 : OTHERS_LEVEL);
  for (const player of Object.values(state.players)) {
    const seen = memory.gestures.get(player.id);
    if (seen === player.gestureAt) continue;
    memory.gestures.set(player.id, player.gestureAt);
    if (seen === undefined || !player.gesture || now - player.gestureAt > 400) continue;
    const foley = GESTURE_FOLEY[player.gesture];
    if (foley) loopEngine.foley(foley, level(player.id));
  }
  for (const [blockId, thrower] of memory.flying) {
    const block = state.blocks[blockId];
    if (block?.status === 'thrown') continue;
    memory.flying.delete(blockId);
    if (block?.status === 'world') loopEngine.foley('floor', level(thrower));
    if (block?.status === 'station') loopEngine.foley('feed', level(thrower));
  }
  const event = state.lastEvent;
  if (event?.type === 'processed' && event.id !== memory.processed) {
    memory.processed = event.id;
    const feeder = memory.machines.get(event.stationId);
    if (now - event.at <= 500) loopEngine.foley('popout', level(feeder));
  }
  for (const stationId of memory.machines.keys()) {
    if (!state.stations[stationId]?.blockId) memory.machines.delete(stationId);
  }
  for (const player of Object.values(state.players)) {
    if (player.heldBlockId) memory.touched.set(player.heldBlockId, player.id);
  }
  for (const block of Object.values(state.blocks)) {
    if (block.status === 'thrown' && !memory.flying.has(block.id)) memory.flying.set(block.id, block.holderId);
    if (block.status === 'thrown' && block.holderId) memory.touched.set(block.id, block.holderId);
    if (block.status === 'station' && block.stationId && !memory.machines.has(block.stationId)) {
      memory.machines.set(block.stationId, memory.touched.get(block.id) ?? null);
    }
  }
}

function landingBars(state: GameState) {
  const bars: number[] = [];
  for (const change of state.song.queued) if (change.sampleName && !bars.includes(change.atBar)) bars.push(change.atBar);
  return bars;
}

export function ShowAudioProvider({ children }: PropsWithChildren) {
  const runtime = useGameRuntime();
  const state = useGameState();
  const themeId = state.themeId;
  const runSeed = state.runSeed;
  const preparing = useShowAudioStatus((status) => status.preparing);
  const lastBlipped = useRef<string | null>(null);
  const stageReady = useStageReady((stage) => stage.ready);
  const backstage = useBackstage((stage) => stage.backstage);
  const [mayFetchAhead, setMayFetchAhead] = useState(false);
  useEffect(() => { void mayPrefetch().then(setMayFetchAhead); }, []);
  const fetchNow = !backstage || mayFetchAhead;

  useEffect(() => {
    if (!stageReady) return;
    const controller = new AbortController();
    const manifests = THEME_IDS.flatMap((id) => openingManifest(id, runSeed));
    void sampleLibrary.cacheBytes(manifests, { signal: controller.signal, concurrency: 6 });
    return () => controller.abort();
  }, [runSeed, stageReady]);

  const unlock = useCallback(async () => {
    await loopEngine.resume();
    setStatus({ unlocked: loopEngine.audible });
  }, []);

  useEffect(() => {
    setStatus({ unlocked: loopEngine.audible });
    return loopEngine.subscribe(() => setStatus({ unlocked: loopEngine.audible }));
  }, []);

  useEffect(() => {
    const kit = theme(themeId);
    loopEngine.prime();
    sampleLibrary.setRun(kit.bpm, runKey(themeId, runSeed));
    if (!fetchNow) return;
    const manifest = openingManifest(themeId, runSeed);
    setStatus({ preparing: true, progress: { total: manifest.length, ready: 0, failed: 0, current: null } });
    const controller = new AbortController();
    void sampleLibrary
      .prepareRound(manifest, { onProgress: (progress) => setStatus({ progress }), signal: controller.signal, concurrency: 6 })
      .then((result) => {
        if (controller.signal.aborted) return;
        setStatus({ failed: result.failed.map((entry) => entry.sampleName), preparing: false });
      })
      .catch(() => setStatus({ preparing: false }));
    return () => controller.abort();
  }, [themeId, runSeed, fetchNow]);

  useEffect(() => {
    if (preparing) return;
    let signature = '';
    let forecast: GameSample[] = [];
    const measure = () => setStatus({ prefetched: forecast.length ? sampleLibrary.readyCount(forecast) / forecast.length : 1 });
    const refresh = (current: GameState) => {
      const next = forecastSignature(current);
      if (next === signature) return;
      signature = next;
      forecast = current.phase === 'lobby'
        ? lobbyForecast(current.themeId, current.runSeed)
        : stockForecast(current);
      sampleLibrary.want(forecast);
      measure();
    };
    const stop = runtime.subscribe(refresh);
    const off = sampleLibrary.subscribe(measure);
    return () => { stop(); off(); };
  }, [runtime, preparing, themeId, runSeed]);

  useEffect(() => {
    if (backstage) { loopEngine.stopLobby(); return; }
    if (state.phase !== 'lobby') return;
    const record = openingRecord(themeId, runSeed);
    if (!record) return;
    const bpm = theme(themeId).bpm;
    const play = () => {
      const buffer = sampleLibrary.getBuffer(record.sampleName);
      if (buffer) loopEngine.playLobby(record, buffer, bpm);
    };
    play();
    const offLibrary = sampleLibrary.subscribe(play);
    const offEngine = loopEngine.subscribe(play);
    return () => { offLibrary(); offEngine(); };
  }, [backstage, state.phase, themeId, runSeed]);

  useEffect(() => {
    let frame = 0;
    let lastSecond = Infinity;
    let scheduledPass = '';
    let signedLayers: unknown = null;
    let signature = '';
    let printedId: string | null = null;
    const hands: HandMemory = { gestures: new Map(), flying: new Map(), touched: new Map(), machines: new Map(), processed: null };
    const tick = () => {
      const current = runtime.getState();
      const event = current.lastEvent;
      if (event?.type === 'section-printed' && event.id !== printedId) {
        printedId = event.id;
        if (runtime.now() - event.at <= 500) loopEngine.printed(event.index);
      }
      loopEngine.chargePrint(current.phase === 'playing' ? current.commitProgress : 0);
      if (current.phase === 'playing') handSounds(current, runtime.now(), runtime.playerId, hands);
      loopEngine.landOn(current.phase === 'playing' ? landingBars(current) : []);
      const aim = useAimStore.getState();
      loopEngine.aimThrow(current.phase === 'playing' && aim.aiming
        ? (aim.power - LOB_POWER_MIN) / (LOB_POWER_MAX - LOB_POWER_MIN)
        : null);
      if (current.phase === 'complete') {
        scheduledPass = scheduleReplay(current, runtime.now(), scheduledPass);
      } else if (scheduledPass) {
        scheduledPass = '';
        loopEngine.stop();
      }
      if (current.phase === 'playing' && current.showEndsAt && current.hardEndsAt) {
        const now = runtime.now();
        const overtime = now >= current.showEndsAt;
        const left = Math.ceil(((overtime ? current.hardEndsAt : current.showEndsAt) - now) / 1000);
        if (left !== lastSecond) {
          if (left >= 1 && left <= 10 && lastSecond !== Infinity) loopEngine.blip('tick');
          if (overtime && (left === 20 || left === 10) && lastSecond !== Infinity) loopEngine.blip('alarm');
          lastSecond = left;
        }
      }
      if (current.phase === 'playing' && current.transportStartedAt) {
        loopEngine.syncTransport(current.bpm, current.transportStartedAt, runtime.now());
        loopEngine.applySong(current.song);
        loopEngine.handOverLobby(current.song.layers.DRUMS.sampleName);
        if (current.song.layers !== signedLayers) {
          signedLayers = current.song.layers;
          signature = mixSignature(current.song.layers);
        }
        loopEngine.meterMix(signature);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      loopEngine.stop();
      loopEngine.stopLobby(0.25);
    };
  }, [runtime]);

  const lastPhase = useRef(state.phase);
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = state.phase;
    if (was === 'lobby' && state.phase !== 'lobby' && state.phase !== 'playing') loopEngine.stopLobby();
    if (state.phase === 'complete' && was === 'playing') loopEngine.windDown();
    else if (state.phase === 'complete') loopEngine.stop();
    if (state.phase === 'playing' && was === 'lobby' && state.transportStartedAt
      && runtime.now() - (state.transportStartedAt - SHOW_INTRO_MS) < 800) {
      loopEngine.fireOpening((state.transportStartedAt - runtime.now()) / 1000);
    }
  }, [state.phase, state.transportStartedAt, runtime]);

  useEffect(() => () => { loopEngine.stop(); loopEngine.stopLobby(0); }, []);

  useEffect(() => {
    if (!DEV_HANDLE) return;
    const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
    handle.audio = () => {
      const snapshot = loopEngine.snapshot();
      return {
        running: snapshot.running,
        bpm: snapshot.bpm,
        bar: snapshot.bar,
        limiterReductionDb: snapshot.limiterReductionDb,
        layers: Object.fromEntries(Object.entries(snapshot.layers).map(([layer, entry]) => [layer, entry.playing
          ? {
            name: entry.playing.name,
            bars: entry.playing.bars,
            gainDb: entry.playing.gainDb,
            bufferSeconds: sampleLibrary.getBuffer(entry.playing.sampleName)?.duration ?? null,
            transform: entry.playing.transform,
            semitones: loopPlan(entry.playing, runtime.getState().bpm, runKey(runtime.getState().themeId, runtime.getState().runSeed)).semitones,
          }
          : null])),
      };
    };
    handle.kit = () => openingManifest(runtime.getState().themeId, runtime.getState().runSeed);
    handle.lobby = () => loopEngine.lobbyRecord;
    handle.buffer = (sampleName: string) => sampleLibrary.getBuffer(sampleName)?.duration ?? null;
    handle.spectrum = () => loopEngine.measure();
    handle.machines = () => loopEngine.machines();
    handle.mixReading = () => {
      const current = runtime.getState();
      return {
        measured: loopEngine.mixReading(mixSignature(current.song.layers), barDurationMs(current.bpm) / 1000),
        model: predictMix(current.themeId, current.song.layers),
      };
    };
    handle.stock = (rackId: string) => rackContents(runtime.getState(), rackId);
    handle.fxIds = () => [...FX_IDS];
    handle.kitAll = () => theme(runtime.getState().themeId).samples;
    handle.regions = () => songRegions(runtime.getState().song.committed);
    handle.playSong = (regions: SongRegion[], bpm: number) => loopEngine.playSong(regions, bpm);
    (window as unknown as { __loop?: unknown }).__loop = handle;
  }, [runtime]);

  useEffect(() => {
    const event = state.lastEvent;
    if (!event || event.id === lastBlipped.current) return;
    lastBlipped.current = event.id;
    if (runtime.now() - event.at > 500) return;
    const kind = blipFor(event);
    if (kind) loopEngine.blip(kind);
  }, [state.lastEvent, runtime]);

  const stopPlayback = useCallback(() => loopEngine.stop(), []);

  const mixReading = useCallback(() => {
    const current = runtime.getState();
    return loopEngine.mixReading(mixSignature(current.song.layers), barDurationMs(current.bpm) / 1000);
  }, [runtime]);

  const heardRewards = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const reward of state.song.rewards) {
      if (heardRewards.current.has(reward.id)) continue;
      heardRewards.current.add(reward.id);
      if (runtime.now() - reward.at > 600 || reward.kind === 'print') continue;
      loopEngine.blip('reward');
    }
  }, [state.song.rewards, runtime]);

  const value = useMemo<ShowAudioValue>(() => ({
    unlock,
    blip: (kind: CueKind) => loopEngine.blip(kind),
    stopPlayback,
    mixReading,
  }), [unlock, stopPlayback, mixReading]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useShowAudio() {
  const value = useContext(Context);
  if (!value) throw new Error('useShowAudio must be inside ShowAudioProvider');
  return value;
}

function scheduleReplay(state: GameState, now: number, scheduled: string): string {
  if (!loopEngine.audible) return scheduled;
  const clock = replayClock(state, now);
  if (!clock || clock.songBars === 0) return scheduled;
  const barMs = barDurationMs(state.bpm);
  let pass = Math.max(0, clock.pass);
  if (clock.position >= 0 && clock.bar >= clock.songBars) pass += 1;
  const key = `${state.completedAt}:${pass}`;
  if (key === scheduled) return scheduled;
  const startsAt = replayPassStartsAt(clock, pass, state.bpm);
  if (startsAt - now > 350) return scheduled;
  if (now - startsAt > (clock.songBars - 1) * barMs) return key;
  loopEngine.playSong(songRegions(state.song.committed), state.bpm, (startsAt - now) / 1000);
  return key;
}

function forecastSignature(state: GameState) {
  if (state.phase === 'lobby') return `lobby|${state.themeId}|${state.runSeed}`;
  const records = Object.values(state.blocks).map((block) => block.sampleName).sort().join(',');
  const queued = state.song.queued.map((change) => change.sampleName ?? '-').join(',');
  return `${state.themeId}|${state.runSeed}|${state.song.sectionIndex}|${records}|${queued}`;
}
