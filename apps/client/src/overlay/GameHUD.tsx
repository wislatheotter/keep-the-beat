import { memo, useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  LOB_POWER_MAX,
  LOB_POWER_MIN,
  LOB_POWER_UNDRAGGED,
  lobLaunch,
  clamp,
  isOvertime,
  recordOnPlatter,
  showRemainingMs,
  theme,
  type BlockState,
  type GameState,
} from '@loop/shared';
import { useGameRuntime, useGameState } from '../runtime/GameRuntimeContext';
import { useShowAudio, useShowAudioStatus } from '../audio/ShowAudioProvider';
import { TouchPad } from './TouchPad';
import { aimAt, cancelAim, lobOrigin, useAimStore } from '../game/aim';
import { pressure } from '../game/beat';
import { livePlayer, resolveInteraction, useFocusStore, type Interaction } from '../game/interaction';
import { RecordFace } from './RecordFace';
import { useBeatPulse } from './useBeatPulse';
import { Icon, type IconName } from './icons';
import { useGuideCue } from '../game/tutorial';
import { HudLead } from './HudLead';

const AIM_HOLD_MS = 165;
const DRAG_DEADBAND_PX = 14;
const DRAG_FULL_POWER_PX = 92;
const COMMIT_TICK_MS = 70;
const COMMIT_HOLD_START_MS = 200;

type GestureState = {
  pointerId: number;
  startX: number;
  startY: number;
  holdTimer: number | null;
  dragged: boolean;
};

export function GameHUD({ onLeave, dormant = false }: { onLeave: () => void; dormant?: boolean }) {
  const state = useGameState();
  const runtime = useGameRuntime();
  const showAudio = useShowAudio();
  const audioStatus = {
    preparing: useShowAudioStatus((status) => status.preparing),
    progress: useShowAudioStatus((status) => status.progress),
  };
  const me = state.players[runtime.playerId];
  const root = useRef<HTMLDivElement>(null);
  useBeatPulse(root, !dormant);
  const gesture = useRef<GestureState | null>(null);
  const keyboardHoldTimer = useRef<number | null>(null);
  const commitTimer = useRef<number | null>(null);
  const commitAttempted = useRef(false);
  const aim = useAimStore();
  const guide = useGuideCue();
  const heldBlock = me?.heldBlockId ? state.blocks[me.heldBlockId] : null;

  const live = useFocusStore((store) => store.interaction);
  const interaction = useMemo(
    () => live ?? resolveInteraction(state, runtime.playerId, runtime.now()),
    [live, state, runtime.playerId],
  );

  const stopCommit = useCallback(() => {
    if (commitTimer.current !== null) window.clearInterval(commitTimer.current);
    commitTimer.current = null;
  }, []);

  const startCommit = useCallback(() => {
    if (commitTimer.current !== null || !me) return;
    commitAttempted.current = true;
    livePlayer.publish?.();
    commitTimer.current = window.setInterval(() => {
      livePlayer.publish?.();
      const current = runtime.getState();
      if (current.phase !== 'playing' || resolveInteraction(current, me.id, runtime.now()).kind !== 'print') {
        stopCommit();
        return;
      }
      runtime.dispatch({ type: 'COMMIT_SECTION', playerId: me.id, deltaMs: COMMIT_TICK_MS, now: runtime.now(), reading: showAudio.mixReading() });
    }, COMMIT_TICK_MS);
  }, [me, runtime, showAudio, stopCommit]);

  useEffect(() => stopCommit, [stopCommit]);

  const performClickAction = useCallback(() => {
    if (!me || state.phase !== 'playing') return;
    void showAudio.unlock();
    livePlayer.publish?.();
    const now = runtime.now();

    switch (interaction.kind) {
      case 'place':
        runtime.dispatch({ type: 'QUEUE_DROP', playerId: me.id, blockId: me.heldBlockId!, now });
        return;
      case 'eject':
        runtime.dispatch({ type: 'QUEUE_CLEAR', playerId: me.id, layer: interaction.layer, now });
        return;
      case 'process':
        runtime.dispatch({ type: 'USE_STATION', playerId: me.id, stationId: interaction.station.id, now });
        return;
      case 'take':
        if (interaction.station) runtime.dispatch({ type: 'TAKE_RECORD', playerId: me.id, stationId: interaction.station.id, now });
        else runtime.dispatch({ type: 'PICKUP_BLOCK', playerId: me.id, blockId: interaction.block.id, now });
        return;
      case 'drop': {
        const forward = { x: Math.sin(me.rotationY), y: 0, z: Math.cos(me.rotationY) };
        runtime.dispatch({
          type: 'DROP_BLOCK',
          playerId: me.id,
          blockId: me.heldBlockId!,
          position: { x: me.position.x + forward.x * 1.15, y: 0.82, z: me.position.z + forward.z * 1.15 },
          now,
        });
        return;
      }
      default:
        return;
    }
  }, [interaction, me, runtime, state.phase, showAudio]);

  const aimAhead = useCallback((mouse = false) => {
    if (!me || !heldBlock || state.phase !== 'playing') return;
    void showAudio.unlock();
    aimAt({ x: Math.sin(me.rotationY), y: 0, z: Math.cos(me.rotationY) }, LOB_POWER_UNDRAGGED, mouse);
  }, [heldBlock, me, state.phase, showAudio]);

  const releaseLob = useCallback(() => {
    const lined = useAimStore.getState();
    if (!me || !heldBlock || !lined.aiming) return false;
    runtime.dispatch({
      type: 'LOB_RECORD',
      playerId: me.id,
      blockId: heldBlock.id,
      position: lobOrigin(me.position, lined.heading),
      velocity: lobLaunch(lined.heading, lined.power),
      now: runtime.now(),
    });
    cancelAim();
    return true;
  }, [heldBlock, me, runtime]);

  const clearGesture = useCallback(() => {
    if (gesture.current?.holdTimer !== null && gesture.current?.holdTimer !== undefined) window.clearTimeout(gesture.current.holdTimer);
    gesture.current = null;
  }, []);

  const canHoldToPrint = (kind: Interaction['kind']) => kind === 'print';

  const onActionPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (gesture.current) return;
    commitAttempted.current = false;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void showAudio.unlock();
    const current: GestureState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      holdTimer: null,
      dragged: false,
    };
    if (heldBlock) current.holdTimer = window.setTimeout(() => aimAhead(), AIM_HOLD_MS);
    else if (canHoldToPrint(interaction.kind)) current.holdTimer = window.setTimeout(startCommit, COMMIT_HOLD_START_MS);
    gesture.current = current;
  }, [aimAhead, heldBlock, interaction.kind, showAudio, startCommit]);

  const onActionPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || !me || !heldBlock) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    const distance = Math.hypot(dx, dy);

    if (distance < DRAG_DEADBAND_PX) {
      if (current.dragged) cancelAim();
      return;
    }

    current.dragged = true;
    if (current.holdTimer !== null) {
      window.clearTimeout(current.holdTimer);
      current.holdTimer = null;
    }

    const pull = clamp((distance - DRAG_DEADBAND_PX) / (DRAG_FULL_POWER_PX - DRAG_DEADBAND_PX), 0, 1);
    aimAt({ x: dx / distance, y: 0, z: dy / distance }, LOB_POWER_MIN + (LOB_POWER_MAX - LOB_POWER_MIN) * pull);
  }, [heldBlock, me]);

  const onActionPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    const wasCommitting = commitAttempted.current;
    commitAttempted.current = false;
    stopCommit();
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    clearGesture();
    if (wasCommitting) return;
    if (!releaseLob()) {
      cancelAim();
      performClickAction();
    }
  }, [clearGesture, releaseLob, performClickAction, stopCommit]);

  const onActionPointerCancel = useCallback(() => {
    clearGesture();
    stopCommit();
    commitAttempted.current = false;
    cancelAim();
  }, [clearGesture, stopCommit]);

  const latest = useRef({ heldBlock, aimAhead, releaseLob, performClickAction, showAudio, interaction, startCommit, stopCommit });
  latest.current = { heldBlock, aimAhead, releaseLob, performClickAction, showAudio, interaction, startCommit, stopCommit };

  useEffect(() => {
    if (dormant) return;
    const onDown = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'Space' || isEditable(event.target)) return;
      event.preventDefault();
      commitAttempted.current = false;
      void latest.current.showAudio.unlock();
      if (latest.current.heldBlock) {
        keyboardHoldTimer.current = window.setTimeout(() => latest.current.aimAhead(true), AIM_HOLD_MS);
      } else if (canHoldToPrint(latest.current.interaction.kind)) {
        keyboardHoldTimer.current = window.setTimeout(() => latest.current.startCommit(), COMMIT_HOLD_START_MS);
      }
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isEditable(event.target)) return;
      event.preventDefault();
      const wasCommitting = commitAttempted.current;
      commitAttempted.current = false;
      latest.current.stopCommit();
      if (keyboardHoldTimer.current !== null) window.clearTimeout(keyboardHoldTimer.current);
      keyboardHoldTimer.current = null;
      if (wasCommitting) return;
      if (!latest.current.releaseLob()) {
        cancelAim();
        latest.current.performClickAction();
      }
    };
    const abortHold = () => {
      latest.current.stopCommit();
      if (keyboardHoldTimer.current !== null) window.clearTimeout(keyboardHoldTimer.current);
      keyboardHoldTimer.current = null;
      if (gesture.current?.holdTimer != null) window.clearTimeout(gesture.current.holdTimer);
      gesture.current = null;
      cancelAim();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.code === 'Escape') abortHold();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('keydown', onEscape);
    window.addEventListener('blur', abortHold);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('keydown', onEscape);
      window.removeEventListener('blur', abortHold);
      if (keyboardHoldTimer.current !== null) window.clearTimeout(keyboardHoldTimer.current);
    };
  }, [dormant]);

  useEffect(() => {
    if (!heldBlock && aim.aiming) cancelAim();
  }, [heldBlock, aim.aiming]);

  const kit = theme(state.themeId);
  const overtime = isOvertime(state, runtime.now());
  const remaining = showRemainingMs(state, runtime.now());

  if (!me) return null;

  const verb = aim.aiming ? 'throw' : ACTION_ICONS[interaction.kind];
  const subject = actionRecord(state, interaction, heldBlock);

  return (
    <div
      className={`hud hud-show ${dormant ? 'is-dormant' : 'is-live'}`}
      ref={root}
      style={{ ['--accent' as string]: kit.look.accent }}
      inert={dormant}
      aria-hidden={dormant || undefined}
    >
      {audioStatus.preparing && (
        <i
          className="hud-progress"
          style={{ width: `${Math.round((audioStatus.progress.ready / Math.max(1, audioStatus.progress.total)) * 100)}%` }}
        />
      )}
      <PressureEdge
        level={state.phase === 'playing' ? Math.round(pressure(state, runtime.now()) * 100) / 100 : 0}
        beat={60 / state.bpm}
        overtime={overtime}
      />

      <div className="hud-top">
        <HudLead onLeave={onLeave} />
        <ShowClock remaining={remaining} playing={state.phase === 'playing'} overtime={overtime} />
        <span />
      </div>

      <TouchPad />

      <button
        className={`action-button hud-action${aim.aiming ? ' is-aiming' : ''}${passive(interaction.kind) ? ' is-passive' : ''}${subject ? ' has-record' : ''}${guide.press ? ' is-coached' : ''}`}
        aria-label={aim.aiming ? 'Throw' : interaction.label}
        onPointerDown={onActionPointerDown}
        onPointerMove={onActionPointerMove}
        onPointerUp={onActionPointerUp}
        onPointerCancel={onActionPointerCancel}
      >
        <span className={`hud-action-slot${subject ? '' : ' is-empty'}`}>
          {subject && (
            <RecordFace key={subject.id} role={subject.role} sampleName={subject.sampleName} spinning />
          )}
        </span>
        {state.commitProgress > 0 && (
          <svg className="hud-action-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle className="ring-track" cx="50" cy="50" r="45" />
            <circle className="ring-fill" cx="50" cy="50" r="45" strokeDasharray={`${(state.commitProgress * RING).toFixed(2)} ${RING}`} />
          </svg>
        )}
        <span className="hud-action-badge" key={verb}>
          <Icon name={verb} />
        </span>
      </button>
    </div>
  );
}

const RING = 282.7;

const ACTION_ICONS: Record<Interaction['kind'], IconName> = {
  take: 'take',
  place: 'place',
  eject: 'eject',
  print: 'keep',
  wait: 'wait',
  process: 'treat',
  blocked: 'blocked',
  drop: 'down',
  idle: 'record',
};

function actionRecord(state: GameState, interaction: Interaction, held: BlockState | null): BlockState | null {
  if (held) return held;
  if (interaction.kind === 'take') return interaction.block;
  if (interaction.kind === 'eject') return recordOnPlatter(state, interaction.layer);
  return null;
}

function passive(kind: Interaction['kind']) {
  return kind === 'blocked' || kind === 'idle' || kind === 'wait';
}

function ShowClock({ remaining, playing, overtime }: { remaining: number; playing: boolean; overtime: boolean }) {
  return <ShowClockFace seconds={Math.ceil(remaining / 1000)} playing={playing} overtime={overtime} />;
}

const ShowClockFace = memo(function ShowClockFace({ seconds, playing, overtime }: { seconds: number; playing: boolean; overtime: boolean }) {
  const final = seconds <= 10 && playing;
  return (
    <div className={`show-clock hud-clock${overtime ? ' is-overtime' : ''}${final ? ' is-final' : ''}`}>
      <span key={final ? seconds : 'steady'}>{formatClock(seconds * 1000)}</span>
    </div>
  );
});

const PressureEdge = memo(function PressureEdge({ level, beat, overtime }: { level: number; beat: number; overtime: boolean }) {
  if (level < 0.03) return null;
  return (
    <div
      className={`pressure-edge${overtime ? ' is-overtime' : ''}`}
      style={{ ['--pressure' as string]: level.toFixed(2), ['--beat' as string]: `${beat.toFixed(3)}s` }}
    />
  );
});

function formatClock(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function isEditable(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element?.closest('input, textarea, select, [contenteditable="true"]');
}
