import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Group, MathUtils, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import {
  avoidSongArc,
  SONG_ARC_COLLISION_RADIUS,
  SONG_ARC_HALF_ANGLE,
  SONG_ARC_RADIUS,
  DECK_COLLISION_RADIUS,
  PLAYER_RADIUS_LIMIT,
  PLAYER_SPEED,
  PLAYER_Y,
  JUMP_MS,
  POSE_INTERVAL_MS,
  REPLAY_HALF_WIDTH,
  blankFx,
  clampToStage,
  deckDistance,
  jumpHeight,
  resolveStationCollision,
  sample as gameSample,
  type GameState,
  type PlayerState,
} from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { useSteer } from '../steer';
import { forgetPoses, makeSampledPose, samplePose } from '../presence';
import { PerformerRig, type PerformerMotion } from './PerformerRig';
import { NameTag } from './NameTag';
import { useAimStore } from '../aim';
import { registerDevTeleport } from '../../runtime/devHandle';
import { livePlayer } from '../interaction';
import { reachTarget } from '../reachTarget';
import { DEMO_LAYER, placeInRow, throughGate, tourFrame, useDemoProps } from '../lobbyTour';
import { DEMO_CRATE_RECORD_ID, demoSample } from '../lobbyStage';
import { DEV_HANDLE } from '../../runtime/devFlag';
import {
  REPLAY_SCALE,
  REPLAY_SPEED,
  easeOutBack,
  hopScale,
  introProgress,
  lobbySeats,
  lobbySlot,
  finaleCut,
  finaleRise,
  replayRotation,
  replayWorld,
  sectionAgeMs,
  stageMode,
  window01,
  type Slot,
  type StageMode,
} from '../stage';

const MAX_STEP_SECONDS = 0.1;
const PUBLISH_INTERVAL = POSE_INTERVAL_MS / 1000;
const APPEAR_MS = 520;
const LOBBY_WALK = 3.2;
const TOUR_FOLLOW = PLAYER_SPEED * 1.35;
const DEMO_WALK = PLAYER_SPEED * 0.65;
const FACE_MS = 450;
const FACE_RATE = 22;
function printSpot(from: Vector3, out: Vector3) {
  const angle = MathUtils.clamp(Math.atan2(from.x, from.z), -PRINT_EDGE, PRINT_EDGE);
  return out.set(Math.sin(angle) * PRINT_RADIUS, from.y, Math.cos(angle) * PRINT_RADIUS);
}
const PRINT_RADIUS = SONG_ARC_RADIUS - SONG_ARC_COLLISION_RADIUS - 0.02;
const PRINT_EDGE = SONG_ARC_HALF_ANGLE - 0.05;
const PRINT_APPROACH_SPEED = PLAYER_SPEED * 0.8;
const spot = new Vector3();

type Staging = {
  mode: StageMode | null;
  placed: boolean;
  yaw: number;
  appearAt: number;
  motion: { current: PerformerMotion };
  from: { position: Vector3; quaternion: Quaternion; scale: number } | null;
  replayX: number;
  hidden: boolean;
  facing: number;
  tag: { current: number };
  ring: Group | null;
  spawnedAt: number | null;
};

function useStaging(playerId: string): Staging {
  return useRef<Staging>({
    mode: null,
    placed: false,
    yaw: 0,
    appearAt: -Infinity,
    motion: { current: { moving: false, wave: 0 } },
    from: null,
    replayX: 0,
    hidden: false,
    facing: hashUnit(playerId) > 0.5 ? 1 : -1,
    tag: { current: 0 },
    ring: null,
    spawnedAt: null,
  }).current;
}

function stageCharacter(
  group: Group,
  staging: Staging,
  context: {
    state: GameState;
    player: PlayerState;
    seat: number;
    aspect: number;
    now: number;
    delta: number;
    local: boolean;
  },
): boolean {
  const { state, player, seat, aspect, now, delta } = context;
  const mode = stageMode(state, now);
  group.userData.lift = 0;
  const entering = mode !== staging.mode;
  const first = staging.mode === null;
  staging.mode = mode;
  const motion = staging.motion.current;

  if (staging.ring) staging.ring.visible = false;

  if (mode === 'lobby') {
    const local = context.local;
    const tour = tourFrame.sample;
    lobbySlot(seat, aspect, slot);
    if (local) placeInRow(tour, slot.x, slot.z, mark);
    else { mark.x = slot.x; mark.z = slot.z; }
    const demo = local ? tourFrame.demo?.spot ?? null : null;
    const restYaw = demo ? tourFrame.demo!.face : local ? slot.yaw + tour.yaw : slot.yaw;
    if (demo) { mark.x = demo.x; mark.z = demo.z; }
    if (entering) {
      group.position.set(mark.x, PLAYER_Y, mark.z);
      staging.yaw = restYaw;
      staging.appearAt = first ? player.joinedAt : now;
    } else if (!local && mark.x * group.position.x < 0) {
      group.position.set(mark.x, PLAYER_Y, mark.z);
      staging.yaw = restYaw;
      staging.appearAt = now;
    }
    if (local) throughGate(group.position, mark);
    target.set(mark.x, PLAYER_Y, mark.z);
    const distance = Math.hypot(target.x - group.position.x, target.z - group.position.z);
    if (distance > 0.01) {
      const pace = !local ? LOBBY_WALK : tour.moving ? TOUR_FOLLOW : tour.stop !== 'home' ? DEMO_WALK : LOBBY_WALK;
      const step = Math.min(distance, pace * Math.min(delta, MAX_STEP_SECONDS));
      group.position.x += ((target.x - group.position.x) / distance) * step;
      group.position.z += ((target.z - group.position.z) / distance) * step;
    }
    group.position.y = PLAYER_Y;
    const touring = local && tour.moving;
    const walking = distance > 0.1 || touring;
    const heading = touring
      ? tour.heading
      : distance > 0.1 ? Math.atan2(target.x - group.position.x, target.z - group.position.z) : restYaw;
    staging.yaw = dampAngle(staging.yaw, heading, walking ? 16 : 6, delta);
    group.rotation.set(0, staging.yaw, 0);
    group.scale.setScalar(appearScale(now - staging.appearAt));
    motion.moving = walking;
    staging.tag.current += ((demo ? 0 : 1) - staging.tag.current) * (1 - Math.exp(-8 * Math.min(delta, MAX_STEP_SECONDS)));
    if (entering) staging.tag.current = 1;
    return true;
  }

  if (mode === 'intro' && tourFrame.popIntro) {
    if (entering && !first) {
      staging.from = { position: group.position.clone(), quaternion: group.quaternion.clone(), scale: group.scale.x };
    }
    const t = introProgress(state, now);
    const stagger = Math.min(seat, 4) * 0.03;
    const from = staging.from;
    const out = MathUtils.clamp((t - stagger * 0.5) / POP_OUT, 0, 1);
    const back = MathUtils.clamp((t - POP_IN_AT - stagger) / POP_IN, 0, 1);
    motion.moving = false;
    staging.tag.current = 0;
    if (from && out < 1) {
      group.position.copy(from.position);
      group.quaternion.copy(from.quaternion);
      group.scale.setScalar(Math.max(0.001, from.scale * (1 - easeInBack(out))));
      popRing(staging, from.position, out);
      return true;
    }
    group.position.set(player.position.x, PLAYER_Y, player.position.z);
    staging.yaw = player.rotationY;
    group.rotation.set(0, staging.yaw, 0);
    group.scale.setScalar(back <= 0 ? 0.001 : Math.max(0.001, easeOutBack(back, 2.2)));
    if (back > 0 && back < 1) popRing(staging, group.position, back);
    return true;
  }

  if (mode === 'intro') {
    const t = introProgress(state, now);
    lobbySlot(seat, aspect, slot);
    const stagger = Math.min(seat, 4) * 0.035;
    const run = window01(t, 0.16 + stagger, 0.6 + stagger);
    const lift = hop(t, 0.02 + stagger * 0.5, 0.13, 0.6);
    group.userData.lift = lift;
    group.position.set(
      MathUtils.lerp(slot.x, player.position.x, run),
      PLAYER_Y + lift,
      MathUtils.lerp(slot.z, player.position.z, run),
    );
    const running = run > 0.02 && run < 0.98;
    const heading = running
      ? Math.atan2(player.position.x - slot.x, player.position.z - slot.z)
      : run >= 0.98 ? player.rotationY : slot.yaw;
    staging.yaw = first ? heading : dampAngle(staging.yaw, heading, 9, delta);
    group.rotation.set(0, staging.yaw, 0);
    group.scale.setScalar(1);
    motion.moving = running;
    staging.tag.current = 1 - window01(t, 0.04, 0.22);
    return true;
  }

  if (mode === 'show') {
    if (entering || staging.spawnedAt !== player.joinedAt) {
      const respawned = !first && staging.spawnedAt !== null && staging.spawnedAt !== player.joinedAt;
      staging.spawnedAt = player.joinedAt;
      group.position.set(player.position.x, PLAYER_Y, player.position.z);
      group.rotation.set(0, player.rotationY, 0);
      staging.yaw = player.rotationY;
      if (respawned && !context.local) forgetPoses(player.id);
    }
    const want = context.local ? 0 : 1;
    staging.tag.current += (want - staging.tag.current) * (1 - Math.exp(-6 * Math.min(delta, MAX_STEP_SECONDS)));
    return false;
  }

  const markX = context.local && !entering ? staging.replayX : player.position.x;
  if (mode === 'outro') {
    if (entering) {
      staging.replayX = player.position.x;
      if (!first) motion.cheer = (motion.cheer ?? 0) + 1;
    }
    motion.moving = false;
    if (!finaleCut(state, now)) {
      if (first || staging.hidden) {
        staging.hidden = true;
        group.scale.setScalar(0.001);
      }
      staging.tag.current = Math.max(0, staging.tag.current - Math.min(delta, MAX_STEP_SECONDS) * 5);
      return true;
    }
    staging.hidden = false;
    replayWorld(staging.replayX, 0, group.position);
    replayRotation(0, group.quaternion);
    group.scale.setScalar(REPLAY_SCALE);
    staging.yaw = 0;
    if (context.local) livePlayer.replayX = staging.replayX;
    staging.tag.current = window01(finaleRise(state, now), 0.3, 0.75);
    return true;
  }

  if (entering) {
    staging.replayX = markX;
    if (first) staging.yaw = player.rotationY;
  }
  staging.tag.current = 1;
  return true;
}

function poseOnPlatform(group: Group, staging: Staging, jumpAt: number, state: GameState, now: number) {
  const own = jumpAt > 0 ? now - jumpAt : Infinity;
  const bandJumps = !DEV_HANDLE || (window as unknown as { __loop?: { bandJumps?: boolean } }).__loop?.bandJumps !== false;
  const ms = own < JUMP_MS + 150 ? own : bandJumps ? sectionAgeMs(state, now) : Infinity;
  const lift = jumpHeight(ms);
  group.userData.lift = lift;
  replayWorld(staging.replayX, lift, group.position);
  replayRotation(staging.yaw, group.quaternion);
  const [across, along] = hopScale(ms);
  group.scale.set(REPLAY_SCALE * across, REPLAY_SCALE * along, REPLAY_SCALE * across);
}

function performerDeps(room: GameState, playerId: string, localId: string) {
  const player = room.players[playerId];
  if (!player) return null;
  const held = room.phase === 'playing' && player.heldBlockId ? room.blocks[player.heldBlockId] : null;
  return [
    room.phase, room.themeId, room.hostId,
    player.id, player.color, player.name, player.joinedAt, player.heldBlockId, player.useUntil, player.gesture, player.gestureAt,
    held && [held.id, held.role, held.sampleName, held.fx],
    lobbySeats(room.players, localId).indexOf(playerId), Object.keys(room.players).indexOf(playerId),
  ];
}

export function LocalPlayer() {
  const runtime = useGameRuntime();
  const state = useGameStateWhen((room) => performerDeps(room, runtime.playerId, runtime.playerId));
  const player = state.players[runtime.playerId];
  const input = useSteer();
  const aim = useAimStore();
  const ref = useRef<Group>(null);
  const lastSync = useRef(0);
  const next = useRef(new Vector3()).current;
  const size = useThree((three) => three.size);
  const staging = useStaging(runtime.playerId);
  const seat = lobbySeats(state.players, runtime.playerId).indexOf(runtime.playerId);
  const demo = useDemoProps();
  const facing = useRef({ at: 0, ok: false, target: new Vector3(), held: null as string | null, released: null as string | null }).current;

  useEffect(() => {
    livePlayer.publish = () => {
      const group = ref.current;
      if (!group || runtime.getState().phase !== 'playing') return;
      lastSync.current = 0;
      runtime.dispatch({
        type: 'PLAYER_TRANSFORM',
        playerId: runtime.playerId,
        position: { x: group.position.x, y: group.position.y, z: group.position.z },
        rotationY: group.rotation.y,
        now: runtime.now(),
      });
    };
    return () => { livePlayer.publish = null; livePlayer.known = false; };
  }, [runtime]);

  useEffect(() => registerDevTeleport((x, z, yaw) => {
    if (!ref.current) return;
    ref.current.position.set(x, ref.current.position.y, z);
    ref.current.rotation.y = yaw ?? Math.atan2(-x, -z);
  }), []);

  useFrame((_, delta) => {
    const state = runtime.getState();
    const player = state.players[runtime.playerId];
    if (!ref.current || !player) return;
    const group = ref.current;
    const now = runtime.now();
    const staged = stageCharacter(group, staging, {
      state,
      player,
      seat: Math.max(0, seat),
      aspect: size.width / Math.max(1, size.height),
      now,
      delta,
      local: true,
    });
    recordLastSeen(player, group);
    if (staged) {
      livePlayer.known = false;
      if (staging.mode === 'replay') driveReplay(group, delta, now, player.jumpAt);
      return;
    }

    const moving = Math.abs(input.x) + Math.abs(input.z) > 0.01;
    staging.motion.current.moving = moving;
    staging.motion.current.aiming = aim.aiming;
    group.scale.setScalar(appearScale(now - player.joinedAt));
    if (moving) {
      const length = Math.hypot(input.x, input.z) || 1;
      const step = Math.min(delta, MAX_STEP_SECONDS);
      const dx = (input.x / length) * PLAYER_SPEED * step;
      const dz = (input.z / length) * PLAYER_SPEED * step;
      next.set(group.position.x + dx, 0, group.position.z + dz);
      clampToStage(next, PLAYER_RADIUS_LIMIT);
      resolveStationCollision(next);
      const arcSafe = avoidSongArc(next);
      next.set(arcSafe.x, arcSafe.y, arcSafe.z);
      clampToStage(next, PLAYER_RADIUS_LIMIT);
      const nextMachineDistance = deckDistance(next);
      if (nextMachineDistance > DECK_COLLISION_RADIUS || deckDistance(group.position) < DECK_COLLISION_RADIUS) {
        group.position.x = next.x;
        group.position.z = next.z;
      }
      const targetRotation = Math.atan2(input.x, input.z);
      group.rotation.y = dampAngle(group.rotation.y, targetRotation, 15, delta);
    }
    if (aim.aiming) {
      group.rotation.y = dampAngle(group.rotation.y, Math.atan2(aim.heading.x, aim.heading.z), 18, delta);
    }
    let approaching = false;
    if (!moving && player.gesture === 'lever' && player.useUntil > now) {
      printSpot(group.position, spot);
      const dx = spot.x - group.position.x;
      const dz = spot.z - group.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.01) {
        const step = Math.min(distance, Math.min(PRINT_APPROACH_SPEED, distance * 10) * Math.min(delta, MAX_STEP_SECONDS));
        next.set(group.position.x + (dx / distance) * step, 0, group.position.z + (dz / distance) * step);
        resolveStationCollision(next);
        const arcSafe = avoidSongArc(next);
        next.set(arcSafe.x, 0, arcSafe.z);
        clampToStage(next, PLAYER_RADIUS_LIMIT);
        group.position.x = next.x;
        group.position.z = next.z;
        approaching = distance > 0.2;
      }
      group.rotation.y = dampAngle(group.rotation.y, Math.atan2(spot.x, spot.z), 16, delta);
    }
    if (approaching) staging.motion.current.moving = true;
    if (player.heldBlockId !== facing.held) {
      if (!player.heldBlockId) facing.released = facing.held;
      facing.held = player.heldBlockId;
    }
    const gesture = player.gesture;
    if (gesture && gesture !== 'lever' && gesture !== 'lob' && now - player.gestureAt < FACE_MS) {
      if (facing.at !== player.gestureAt) {
        facing.at = player.gestureAt;
        facing.ok = reachTarget(state, gesture, player.heldBlockId ?? facing.released, group.position, facing.target);
      }
      const dx = facing.target.x - group.position.x;
      const dz = facing.target.z - group.position.z;
      if (facing.ok && !moving && Math.hypot(dx, dz) > 0.25) {
        group.rotation.y = dampAngle(group.rotation.y, Math.atan2(dx, dz), FACE_RATE, delta);
      }
    }

    livePlayer.position.copy(group.position);
    livePlayer.known = true;

    lastSync.current += delta;
    if (lastSync.current >= PUBLISH_INTERVAL) {
      lastSync.current = 0;
      runtime.publishPose({
        t: runtime.now(),
        x: group.position.x,
        y: group.position.y,
        z: group.position.z,
        yaw: group.rotation.y,
        moving: moving || approaching,
        aiming: aim.aiming,
      });
    }
  }, -1);

  const driveReplay = (group: Group, delta: number, now: number, jumpAt: number) => {
    const step = Math.min(delta, MAX_STEP_SECONDS);
    const along = Math.abs(input.x) > 0.12 ? Math.sign(input.x) * Math.min(1, Math.abs(input.x) * 1.25) : 0;
    staging.replayX = MathUtils.clamp(staging.replayX + along * REPLAY_SPEED * step, -REPLAY_HALF_WIDTH, REPLAY_HALF_WIDTH);
    if (along !== 0) staging.facing = Math.sign(along);
    staging.yaw = dampAngle(staging.yaw, staging.facing * (along !== 0 ? 1.2 : 0.38), 12, delta);
    staging.motion.current.moving = along !== 0;
    poseOnPlatform(group, staging, jumpAt, runtime.getState(), now);
    livePlayer.replayX = staging.replayX;

    lastSync.current += delta;
    if (lastSync.current >= PUBLISH_INTERVAL) {
      lastSync.current = 0;
      runtime.publishPose({
        t: runtime.now(),
        x: staging.replayX,
        y: PLAYER_Y,
        z: 0,
        yaw: staging.yaw,
        moving: along !== 0,
        aiming: false,
      });
    }
  };

  if (!player) return null;
  const show = state.phase === 'playing';
  const held = show && player.heldBlockId ? state.blocks[player.heldBlockId] : null;
  const lobby = state.phase === 'lobby';
  return (
    <>
    <PopRing staging={staging} color={player.color} />
    <group ref={ref} name="performer-you">
      <PerformerRig
        playerId={player.id}
        color={player.color}
        heldSample={lobby ? (demo.held === 'none' ? null : DEMO_LAYER) : held?.role ?? null}
        heldFamily={lobby ? gameSample(demoSample(state.themeId))?.family : held ? gameSample(held.sampleName)?.family : undefined}
        heldSampleName={lobby ? demoSample(state.themeId) : held?.sampleName ?? null}
        heldFx={lobby ? (demo.held === 'treated' ? CRUSHED : undefined) : held?.fx}
        heldBlockId={lobby ? (demo.held === 'plain' && demo.gesture === 'grab' ? DEMO_CRATE_RECORD_ID : null) : held?.id ?? null}
        motion={staging.motion}
        useUntil={player.useUntil}
        gesture={lobby ? demo.gesture : player.gesture}
        gestureAt={lobby ? demo.gestureAt : player.gestureAt}
        printAt={lobby ? demo.printAt : 0}
        now={runtime.now()}
      />
      <PerformerTag state={state} player={player} visibility={staging.tag} />
    </group>
    </>
  );
}

export function RemotePlayer({ playerId }: { playerId: string }) {
  const runtime = useGameRuntime();
  const state = useGameStateWhen((room) => performerDeps(room, playerId, runtime.playerId));
  const player = state.players[playerId];
  const ref = useRef<Group>(null);
  const target = useRef(new Vector3());
  const pose = useRef(makeSampledPose()).current;
  const size = useThree((three) => three.size);
  const staging = useStaging(playerId);
  const seat = lobbySeats(state.players, runtime.playerId).indexOf(playerId);

  useLayoutEffect(() => {
    const group = ref.current;
    const initial = runtime.getState().players[playerId];
    if (!group || !initial) return;
    group.position.set(initial.position.x, initial.position.y, initial.position.z);
    group.rotation.set(0, initial.rotationY, 0);
  }, [playerId, runtime]);

  useEffect(() => () => forgetPoses(playerId), [playerId]);

  useFrame((_, delta) => {
    const state = runtime.getState();
    const player = state.players[playerId];
    if (!ref.current || !player) return;
    const group = ref.current;
    const now = runtime.now();
    const staged = stageCharacter(group, staging, {
      state,
      player,
      seat: Math.max(0, seat),
      aspect: size.width / Math.max(1, size.height),
      now,
      delta,
      local: false,
    });
    recordLastSeen(player, group);
    const played = samplePose(playerId, delta, pose);

    if (staged) {
      if (staging.mode === 'replay') {
        if (played) {
          staging.replayX = pose.x;
          staging.yaw = pose.yaw;
          staging.motion.current.moving = pose.moving;
        } else {
          staging.replayX += (player.position.x - staging.replayX) * (1 - Math.exp(-delta * 10));
          staging.yaw = dampAngle(staging.yaw, player.rotationY, 11, delta);
          staging.motion.current.moving = player.movingUntil > now;
        }
        poseOnPlatform(group, staging, player.jumpAt, state, now);
      }
      return;
    }

    if (played) {
      group.position.set(pose.x, pose.y, pose.z);
      group.rotation.y = pose.yaw;
      staging.motion.current.moving = pose.moving;
      staging.motion.current.aiming = pose.aiming;
    } else {
      target.current.set(player.position.x, player.position.y, player.position.z);
      group.position.lerp(target.current, 1 - Math.exp(-delta * 9));
      group.rotation.y = dampAngle(group.rotation.y, player.rotationY, 11, delta);
      staging.motion.current.moving = player.movingUntil > now;
      staging.motion.current.aiming = false;
    }
    group.scale.setScalar(appearScale(now - player.joinedAt));
  });

  if (!player) return null;
  const show = state.phase === 'playing';
  const held = show && player.heldBlockId ? state.blocks[player.heldBlockId] : null;
  return (
    <>
    <PopRing staging={staging} color={player.color} />
    <group ref={ref} name={`performer-${player.id}`}>
      <PerformerRig
        playerId={player.id}
        color={player.color}
        heldSample={held?.role ?? null}
        heldFamily={held ? gameSample(held.sampleName)?.family : undefined}
        heldSampleName={held?.sampleName ?? null}
        heldFx={held?.fx}
        heldBlockId={held?.id ?? null}
        motion={staging.motion}
        useUntil={player.useUntil}
        gesture={player.gesture}
        gestureAt={player.gestureAt}
        now={runtime.now()}
      />
      <PerformerTag state={state} player={player} visibility={staging.tag} />
    </group>
    </>
  );
}

function PerformerTag({ state, player, visibility }: { state: GameState; player: PlayerState; visibility: { current: number } }) {
  const replay = state.phase === 'complete';
  return (
    <NameTag
      name={player.name}
      height={replay ? 2.15 : 1.65}
      visibility={visibility}
    />
  );
}

type Seen = { position: Vector3; quaternion: Quaternion; scale: Vector3; color: string };
const lastSeen = new Map<string, Seen>();

function recordLastSeen(player: PlayerState, group: Group) {
  let seen = lastSeen.get(player.id);
  if (!seen) {
    seen = { position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3(1, 1, 1), color: player.color };
    lastSeen.set(player.id, seen);
  }
  seen.position.copy(group.position);
  seen.quaternion.copy(group.quaternion);
  seen.scale.copy(group.scale);
  seen.color = player.color;
}

export function LeavingPerformers() {
  const state = useGameStateWhen((room) => [Object.keys(room.players), room.phase]);
  const [leaving, setLeaving] = useState<Array<{ id: string; at: number } & Seen>>([]);
  const previous = useRef<string[]>(Object.keys(state.players));
  const ids = Object.keys(state.players).join('|');

  useEffect(() => {
    const current = Object.keys(state.players);
    const gone = previous.current.filter((id) => !current.includes(id));
    previous.current = current;
    if (!gone.length || state.phase === 'playing') return;
    const at = performanceNow();
    setLeaving((list) => [
      ...list,
      ...gone.flatMap((id) => {
        const seen = lastSeen.get(id);
        lastSeen.delete(id);
        return seen ? [{ id, at, ...seen }] : [];
      }),
    ]);
  }, [ids]);

  useEffect(() => {
    if (!leaving.length) return;
    const timer = window.setTimeout(() => setLeaving((list) => list.filter((entry) => performanceNow() - entry.at < LEAVE_MS)), LEAVE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return <>{leaving.map((entry) => <Departing key={`${entry.id}:${entry.at}`} entry={entry} />)}</>;
}

const LEAVE_MS = 520;

function Departing({ entry }: { entry: { id: string; at: number } & Seen }) {
  const ref = useRef<Group>(null);
  const ring = useRef<Group>(null);
  const motion = useMemo(() => ({ current: { moving: false, wave: 0 } }), []);
  useFrame(() => {
    const t = Math.min(1, (performanceNow() - entry.at) / LEAVE_MS);
    if (ref.current) {
      const k = Math.max(0.001, 1 - easeInBack(t));
      ref.current.scale.copy(entry.scale).multiplyScalar(k);
    }
    if (ring.current) ring.current.scale.setScalar(0.6 + t * 1.6);
  });
  return (
    <group position={entry.position} quaternion={entry.quaternion}>
      <group ref={ref}>
        <PerformerRig playerId={entry.id} color={entry.color} motion={motion} now={0} />
      </group>
      <group ref={ring} position={[0, -0.7, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <ringGeometry args={[0.7, 0.86, 32]} />
          <meshBasicMaterial color={entry.color} transparent opacity={0.7} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

const POP_OUT = 0.14;
const POP_IN_AT = 0.6;
const POP_IN = 0.14;

function popRing(staging: Staging, at: Vector3, u: number) {
  const ring = staging.ring;
  if (!ring) return;
  ring.visible = true;
  ring.position.set(at.x, 0.05, at.z);
  ring.scale.setScalar(0.6 + u * 1.6);
  const mesh = ring.children[0] as Mesh | undefined;
  if (mesh) (mesh.material as MeshBasicMaterial).opacity = (1 - u) * 0.7;
}

function PopRing({ staging, color }: { staging: Staging; color: string }) {
  return (
    <group ref={(group) => { staging.ring = group; }} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <ringGeometry args={[0.7, 0.86, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

const slot: Slot = { x: 0, z: 0, yaw: 0 };
const mark = { x: 0, z: 0 };
const CRUSHED = { ...blankFx(), crush: true };
const target = new Vector3();

const performanceNow = () => performance.now();

function hop(t: number, at: number, span: number, height: number) {
  const u = (t - at) / span;
  return u > 0 && u < 1 ? Math.sin(u * Math.PI) * height : 0;
}

function appearScale(ms: number) {
  if (ms >= APPEAR_MS) return 1;
  if (ms <= 0) return 0.001;
  return Math.max(0.001, easeOutBack(ms / APPEAR_MS, 2.2));
}

function easeInBack(t: number) {
  const c = 1.9;
  return (c + 1) * t * t * t - c * t * t;
}

function hashUnit(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 10000) / 10000;
}

function dampAngle(current: number, target: number, lambda: number, delta: number) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * (1 - Math.exp(-lambda * delta));
}
