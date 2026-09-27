import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  DECK_PLINTH_RADIUS,
  DECK_POSITION,
  STATIONS,
  canPrint,
  platterPosition,
  songArcSlot,
  stationPosition,
  theme,
  type BlockState,
  type GameState,
  type LoopLayer,
  type StationKind,
  type Vec3,
} from '@loop/shared';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { beatInfo } from '../beat';
import { livePlayer, useFocusStore, type Interaction } from '../interaction';
import { routeAroundDeck, routeLength, type FloorPoint } from '../guidePath';
import { isTouchLayout, setGuideCue, useTutorial, type Lesson } from '../tutorial';
import { stageMode } from '../stage';
import { FloatingWord, FloorTrail, TRAIL_END_GAP, TRAIL_START_GAP, type TrailRoute, type Word, type WordView } from './guideProps';
import { recordPose } from './Handoff';

export function Guide() {
  const runtime = useGameRuntime();
  const view = useMemo<WordView>(() => ({ camera: null!, width: 1, height: 1, host: null }), []);
  const props = useMemo(() => ({
    self: new FloatingWord(),
    target: new FloatingWord(),
    print: new FloatingWord(),
    near: new FloatingWord(),
    trail: new FloorTrail(),
  }), []);
  const memory = useRef<Memory>({
    last: null,
    moved: 0,
    held: null,
    heldAt: 0,
    rack: null,
    machineShown: false,
    printsAtStart: -1,
    sawShow: false,
  }).current;
  const route = useMemo<TrailRoute>(() => ({ key: '', lines: [] }), []);
  const touch = useRef(isTouchLayout());

  useEffect(() => () => { props.self.dispose(); props.target.dispose(); props.print.dispose(); props.near.dispose(); }, [props]);
  useEffect(() => {
    let query: MediaQueryList | null = null;
    try { query = window.matchMedia('(pointer: coarse), (max-width: 900px)'); } catch { return; }
    const listen = () => { touch.current = query!.matches; };
    query.addEventListener('change', listen);
    return () => query!.removeEventListener('change', listen);
  }, []);
  useEffect(() => () => setGuideCue(false), []);

  useFrame((three, delta) => {
    const state = runtime.getState();
    const now = runtime.now();
    const seconds = three.clock.elapsedTime;
    view.camera = three.camera;
    view.width = three.size.width;
    view.height = three.size.height;
    view.host = three.gl.domElement.parentElement;
    const accent = theme(state.themeId).look.accent;
    const me = state.players[runtime.playerId];
    const mode = stageMode(state, now);
    const tutorial = useTutorial.getState();

    if (mode === 'lobby') {
      memory.sawShow = false;
      memory.printsAtStart = -1;
      memory.last = null;
    }
    if (mode === 'show') memory.sawShow = true;
    if (state.phase === 'complete' && memory.sawShow && !tutorial.retired) tutorial.retire();

    const showing = mode === 'show' && !!me;
    const teaching = showing && !tutorial.retired;
    let self: Word | null = null;
    let target: Word | null = null;
    let print: Word | null = null;
    let near: Word | null = null;
    let trail: TrailRoute | null = null;
    let pressing = false;

    if (showing && me) {
      const at: Vec3 = livePlayer.known ? livePlayer.position : me.position;
      learnFromPlay(state, me.heldBlockId, at, now, memory, tutorial.learn);
      const focus = useFocusStore.getState().interaction;
      const press = (hold = false) => (hold
        ? (touch.current ? 'HOLD THE BUTTON' : 'HOLD SPACE')
        : (touch.current ? 'TAP THE BUTTON' : 'PRESS SPACE'));

      if (focus) {
        const word = nearWord(state, focus, press);
        near = word;
        pressing = !!word?.press;
      }

      if (teaching) {
        const learned = useTutorial.getState().learned;
        const held = me.heldBlockId ? state.blocks[me.heldBlockId] ?? null : null;
        if (!learned.has('move')) {
          const chip = touch.current ? 'USE THE STICK' : 'WASD';
          self = { key: `move|${chip}`, text: 'MOVE', chip, x: at.x, y: 3.1, z: at.z };
        }
        if (!learned.has('take') || !learned.has('place')) {
          if (held && focus?.kind !== 'place') {
            const layer = held.role as LoopLayer;
            const platter = platterPosition(layer);
            target = { key: `place|${layer}`, text: 'PUT IT ON THE DECK', chip: null, x: platter.x, y: 3.2, z: platter.z };
            trail = singleLine(route, at, deckEdgeToward(platter), `deck|${layer}`);
          } else if (!held && focus?.kind !== 'take') {
            const record = nearestCrateTop(state, at, memory.rack);
            memory.rack = record?.rackId ?? null;
            if (record) {
              target = { key: `take|${record.rackId}`, text: 'GRAB A RECORD', chip: null, x: record.position.x, y: 3.5, z: record.position.z };
              trail = crateTrail(route, state, at, record);
            }
          }
        } else if (!learned.has('machine') && held && !Object.values(held.fx).some(Boolean) && focus?.kind !== 'process' && focus?.kind !== 'blocked') {
          const machine = nearestMachine(at);
          const spot = stationPosition(machine);
          memory.machineShown = true;
          target = { key: `machine|${machine.id}`, text: 'ADD AN EFFECT', chip: 'OPTIONAL', x: spot.x, y: 4.2, z: spot.z };
        }
        if (!learned.has('print') && learned.has('place') && state.song.committed.length === 0 && canPrint(state, now)
          && focus?.kind !== 'print' && focus?.kind !== 'wait') {
          const slot = songArcSlot(state.song.sectionIndex);
          print = { key: 'print', text: 'PRINT THE SECTION', chip: 'WHEN IT SOUNDS RIGHT', x: slot.x, y: 2.9, z: slot.z };
        }
      }
      if (!print && canPrint(state, now) && now - state.song.sectionStartedAt >= PRINT_REMINDER_MS
        && focus?.kind !== 'print' && focus?.kind !== 'wait') {
        const slot = songArcSlot(state.song.sectionIndex);
        print = { key: 'print|reminder', text: 'PRINT THE SECTION', chip: 'WHEN IT SOUNDS RIGHT', x: slot.x, y: 2.9, z: slot.z };
      }
    }

    const beat = beatInfo(state, now);
    props.self.update(self, accent, delta, view, seconds);
    props.target.update(target, accent, delta, view, seconds);
    props.print.update(print, accent, delta, view, seconds);
    props.near.update(near, accent, delta, view, seconds);
    props.trail.update(trail, accent, delta, beat.beat + beat.beatPhase, beat.pulse);
    setGuideCue(pressing && touch.current);
  });

  return (
    <group name="guide">
      <primitive object={props.trail.mesh} />
    </group>
  );
}

const PRINT_REMINDER_MS = 60_000;

const MACHINE_WORDS: Record<Exclude<StationKind, 'rack'>, string> = {
  echo: 'FEEDBACK DELAY',
  crusher: 'DISTORTION',
  filter: 'LOW-PASS FILTER',
  space: 'REVERB',
  wide: 'STEREO DETUNE',
  swirl: 'PHASER',
  warp: 'PITCH-SHIFTING DELAY',
  washer: 'REMOVES ALL EFFECTS',
};

type NearWord = Word & { press: boolean };

function nearWord(state: GameState, focus: Interaction, press: (hold?: boolean) => string): NearWord | null {
  switch (focus.kind) {
    case 'take': {
      const at = recordPose(focus.block.id)?.position ?? focus.block.position;
      const crate = focus.block.status === 'racked';
      return {
        key: `near|take|${focus.station?.id ?? focus.block.id}`,
        text: crate ? 'GRAB A RECORD' : 'PICK IT UP',
        chip: press(),
        x: at.x, y: crate ? 3.5 : 2.3, z: at.z,
        press: true,
      };
    }
    case 'place': {
      const at = platterPosition(focus.layer);
      const swap = focus.label === 'SWAP IT IN';
      return { key: `near|place|${focus.layer}|${swap}`, text: swap ? 'SWAP IT IN' : 'PUT IT ON THE DECK', chip: press(), x: at.x, y: 3.2, z: at.z, press: true };
    }
    case 'eject': {
      const at = platterPosition(focus.layer);
      return { key: `near|eject|${focus.layer}`, text: 'TAKE IT OFF', chip: press(), x: at.x, y: 3.2, z: at.z, press: true };
    }
    case 'process':
    case 'blocked': {
      const station = focus.station ?? STATIONS.find((each) => each.kind !== 'rack' && each.label === focus.hint) ?? null;
      if (!station || station.kind === 'rack') return null;
      const at = stationPosition(station);
      const ready = focus.kind === 'process';
      const chip = ready ? press() : focus.label;
      return {
        key: `near|machine|${station.id}|${chip}`,
        text: MACHINE_WORDS[station.kind as Exclude<StationKind, 'rack'>],
        chip,
        x: at.x, y: 4.2, z: at.z,
        press: ready,
      };
    }
    case 'print': {
      const slot = songArcSlot(state.song.sectionIndex);
      return { key: 'near|print', text: 'PRINT THE SECTION', chip: press(true), x: slot.x, y: 2.9, z: slot.z, press: true };
    }
    default:
      return null;
  }
}

const FAN_NEAR = 8.5;

function nextLine(route: TrailRoute, index: number) {
  return route.lines[index] ?? (route.lines[index] = { points: [], count: 0, offset: 0, startGap: 0, endGap: 0 });
}

function crateTrail(route: TrailRoute, state: GameState, at: Vec3, nearest: BlockState): TrailRoute {
  const fronts: FloorPoint[] = [];
  for (const block of Object.values(state.blocks)) {
    if (block.status === 'racked' && block.slot === 0) fronts.push(inFrontOf(block.position));
  }
  const middle = {
    x: fronts.reduce((sum, point) => sum + point.x, 0) / Math.max(1, fronts.length),
    z: fronts.reduce((sum, point) => sum + point.z, 0) / Math.max(1, fronts.length),
  };
  if (fronts.length < 2 || Math.hypot(at.x - middle.x, at.z - middle.z) > FAN_NEAR) {
    return singleLine(route, at, inFrontOf(nearest.position), `crate|${nearest.rackId}`);
  }
  route.key = 'crates';
  fronts.forEach((front, index) => {
    const line = nextLine(route, index);
    line.count = routeAroundDeck({ x: at.x, z: at.z }, front, line.points);
    line.offset = 0;
    line.startGap = TRAIL_START_GAP;
    line.endGap = TRAIL_END_GAP;
  });
  route.lines.length = fronts.length;
  return route;
}

function singleLine(route: TrailRoute, from: Vec3, to: FloorPoint, key: string): TrailRoute {
  const line = nextLine(route, 0);
  line.count = routeAroundDeck({ x: from.x, z: from.z }, to, line.points);
  line.offset = 0;
  line.startGap = TRAIL_START_GAP;
  line.endGap = TRAIL_END_GAP;
  route.lines.length = 1;
  route.key = key;
  return route;
}

type Memory = {
  last: FloorPoint | null;
  moved: number;
  held: string | null;
  heldAt: number;
  rack: string | null;
  machineShown: boolean;
  printsAtStart: number;
  sawShow: boolean;
};

function learnFromPlay(
  state: GameState,
  heldBlockId: string | null,
  at: Vec3,
  now: number,
  memory: Memory,
  learn: (lesson: Lesson) => void,
) {
  if (memory.last) memory.moved += Math.hypot(at.x - memory.last.x, at.z - memory.last.z);
  memory.last = { x: at.x, z: at.z };
  if (memory.moved > 4) learn('move');

  if (heldBlockId) {
    learn('take');
    memory.held = heldBlockId;
    memory.heldAt = now;
  } else if (memory.held) {
    const record = state.blocks[memory.held];
    if (record?.status === 'deck') {
      learn('place');
      if (memory.machineShown) learn('machine');
      memory.held = null;
    } else if (record?.status === 'station') {
      learn('machine');
      memory.held = null;
    } else if (!record || now - memory.heldAt > 4000) {
      memory.held = null;
    }
  }

  const prints = state.song.committed.length;
  if (memory.printsAtStart < 0) memory.printsAtStart = prints;
  else if (prints > memory.printsAtStart) learn('print');
}

function nearestCrateTop(state: GameState, at: Vec3, current: string | null): BlockState | null {
  let best: BlockState | null = null;
  let bestDistance = Infinity;
  let kept: BlockState | null = null;
  let keptDistance = Infinity;
  for (const block of Object.values(state.blocks)) {
    if (block.status !== 'racked' || block.slot !== 0) continue;
    const distance = Math.hypot(block.position.x - at.x, block.position.z - at.z);
    if (distance < bestDistance) { best = block; bestDistance = distance; }
    if (block.rackId === current) { kept = block; keptDistance = distance; }
  }
  return kept && keptDistance < bestDistance + 2.5 ? kept : best;
}

function nearestMachine(at: Vec3) {
  let best = STATIONS[0]!;
  let bestDistance = Infinity;
  for (const station of STATIONS) {
    if (station.kind === 'rack') continue;
    const spot = stationPosition(station);
    const distance = Math.hypot(spot.x - at.x, spot.z - at.z);
    if (distance < bestDistance) { best = station; bestDistance = distance; }
  }
  return best;
}

function inFrontOf(position: Vec3): FloorPoint {
  const distance = Math.hypot(position.x, position.z) || 1;
  const back = Math.min(2, distance);
  return { x: position.x - (position.x / distance) * back, z: position.z - (position.z / distance) * back };
}

function deckEdgeToward(platter: Vec3): FloorPoint {
  const dx = platter.x - DECK_POSITION.x;
  const dz = platter.z - DECK_POSITION.z;
  const distance = Math.hypot(dx, dz) || 1;
  const reach = DECK_PLINTH_RADIUS + 0.9;
  return { x: DECK_POSITION.x + (dx / distance) * reach, z: DECK_POSITION.z + (dz / distance) * reach };
}
