import { MathUtils, Vector3 } from 'three';
import { create } from 'zustand';
import {
  SECTION_PLAN,
  DECK_COLLISION_RADIUS,
  DECK_PLINTH_RADIUS,
  DECK_POSITION,
  PLAYER_SPEED,
  RACKS,
  SONG_ARC_RADIUS,
  STATION_BY_ID,
  stationPosition,
} from '@loop/shared';
import { alongRoute, routeAroundDeck, routeLength, type FloorPoint } from './guidePath';
import { LOBBY_Z, lobbyShot, type Shot } from './stage';
import { DEMO_TIMES, HANDS_MS, pressLanding } from './lobbyStage';

type StopId = 'home' | 'racks' | 'machine' | 'deck' | 'arc';

export type TourWord = { text: string; chip: string | null; x: number; y: number; z: number; size: number };

type Stop = {
  id: StopId;
  anchor: FloorPoint;
  yaw: number;
  dwell: number;
  word: TourWord | null;
  crane: number;
  over?: number;
  later?: { from: number; to: number; word: TourWord };
};

export type TourSample = {
  anchorX: number;
  anchorZ: number;
  yaw: number;
  viewYaw: number;
  heading: number;
  crane: number;
  over: number;
  lift: number;
  moving: boolean;
  stop: StopId | null;
  leaving: StopId | null;
  going: StopId | null;
  stopMs: number;
  stopLeftMs: number;
  word: TourWord | null;
  lap: number;
};

const HOME: FloorPoint = { x: 0, z: LOBBY_Z };
const TOUR_SPEED = PLAYER_SPEED * 0.8;
const REST_MS = 12_000;
const FIRST_REST_MS = 2_000;
const STOP_MS = 4_600;
const TOUR_MARGIN = 0.8;
const STAND_OFF = 4.2;

function inFront(focus: FloorPoint, by: number): { anchor: FloorPoint; yaw: number } {
  const distance = Math.hypot(focus.x, focus.z) || 1;
  const inward = { x: -focus.x / distance, z: -focus.z / distance };
  return { anchor: { x: focus.x + inward.x * by, z: focus.z + inward.z * by }, yaw: Math.atan2(inward.x, inward.z) };
}

function buildStops(): Stop[] {
  const racks = RACKS.map(stationPosition);
  const racksAt = {
    x: racks.reduce((sum, at) => sum + at.x, 0) / racks.length,
    z: racks.reduce((sum, at) => sum + at.z, 0) / racks.length,
  };
  const rackStand = inFront(racksAt, STAND_OFF);
  const machine = STATION_BY_ID['st-crusher']!;
  const machineAt = stationPosition(machine);
  const machineStand = inFront(machineAt, STAND_OFF + 0.4);

  return [
    {
      id: 'home',
      anchor: HOME,
      yaw: 0,
      dwell: REST_MS,
      word: null,
      crane: 0,
      later: {
        from: 1600,
        to: 8000,
        word: { text: `PRINT ALL ${SECTION_PLAN.length} SECTIONS`, chip: 'THEN EXPORT THE SONG TO AUDIOTOOL', x: 0, y: 3.9, z: 3.6, size: 0.95 },
      },
    },
    {
      id: 'racks',
      ...rackStand,
      dwell: STOP_MS,
      word: { text: 'GRAB A RECORD', chip: null, x: racksAt.x, y: 3.55, z: racksAt.z + 0.6, size: 0.95 },
      crane: 0,
    },
    {
      id: 'machine',
      ...machineStand,
      dwell: STOP_MS + 1100,
      word: { text: 'ADD AN EFFECT', chip: 'OPTIONAL', x: machineAt.x, y: 3.1, z: machineAt.z, size: 0.72 },
      crane: 0,
    },
    {
      id: 'deck',
      anchor: HOME,
      yaw: 0,
      dwell: STOP_MS,
      word: { text: 'PUT IT ON THE DECK', chip: null, x: 0, y: 3.9, z: 3.6, size: 0.95 },
      crane: 0,
      over: 1,
    },
    {
      id: 'arc',
      anchor: HOME,
      yaw: 0,
      dwell: STOP_MS,
      word: { text: 'HOLD TO PRINT', chip: 'WHEN IT SOUNDS RIGHT', x: 0, y: 3.3, z: SONG_ARC_RADIUS + 0.2, size: 0.5 },
      crane: 1,
    },
  ];
}

type Leg =
  | { kind: 'stay'; stop: Stop; start: number; end: number }
  | { kind: 'go'; from: Stop; to: Stop; points: FloorPoint[]; count: number; length: number; start: number; end: number };

type Timeline = { legs: Leg[]; cycle: number };

let timeline: Timeline | null = null;

function build(): Timeline {
  const stops = buildStops();
  const legs: Leg[] = [];
  let clock = 0;
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i]!;
    legs.push({ kind: 'stay', stop, start: clock, end: clock + stop.dwell });
    clock += stop.dwell;
    const next = stops[(i + 1) % stops.length]!;
    const gap = Math.hypot(next.anchor.x - stop.anchor.x, next.anchor.z - stop.anchor.z);
    if (gap < 0.1) continue;
    const points: FloorPoint[] = [];
    const count = tourRoute(stop.anchor, next.anchor, points);
    const length = routeLength(points, count);
    const span = (length / TOUR_SPEED) * 1000 / (1 - EASE / 2) + 250;
    legs.push({ kind: 'go', from: stop, to: next, points, count, length, start: clock, end: clock + span });
    clock += span;
  }
  return { legs, cycle: clock };
}

export const LOBBY_GATE: FloorPoint = { x: HOME.x, z: DECK_POSITION.z + DECK_COLLISION_RADIUS + TOUR_MARGIN };
const GATE_LINE = LOBBY_GATE.z + 0.2;
const AT_GATE = 0.35;

const atHome = (point: FloorPoint) => Math.hypot(point.x - HOME.x, point.z - HOME.z) < 0.1;

function tourRoute(from: FloorPoint, to: FloorPoint, out: FloorPoint[]): number {
  const round: FloorPoint[] = [];
  const count = routeAroundDeck(atHome(from) ? LOBBY_GATE : from, atHome(to) ? LOBBY_GATE : to, round, TOUR_MARGIN);
  let written = 0;
  if (atHome(from)) out[written++] = { ...from };
  for (let i = 0; i < count; i += 1) out[written++] = { ...round[i]! };
  if (atHome(to)) out[written++] = { ...to };
  return written;
}

export function throughGate(from: FloorPoint, to: FloorPoint) {
  const front = from.z > GATE_LINE;
  if (front === to.z > GATE_LINE) return;
  if (!front && Math.hypot(from.x - LOBBY_GATE.x, from.z - LOBBY_GATE.z) < AT_GATE) return;
  to.x = LOBBY_GATE.x;
  to.z = LOBBY_GATE.z;
}

let elapsed: number | null = null;
let lastNow = 0;
const MAX_FRAME_MS = 100;

export function tourClock(now: number): number {
  if (elapsed === null) elapsed = REST_MS - FIRST_REST_MS;
  else elapsed += Math.min(MAX_FRAME_MS, Math.max(0, now - lastNow));
  lastNow = now;
  return elapsed;
}

export function seekTour(ms: number, now: number) {
  elapsed = ms;
  lastNow = now;
}

export function tourLegs() {
  timeline ??= build();
  return timeline.legs.map((leg) => ({ kind: leg.kind, stop: leg.kind === 'stay' ? leg.stop.id : `${leg.from.id}>${leg.to.id}`, start: leg.start, end: leg.end }));
}

export function resetTour() {
  elapsed = null;
}

const cursor = { x: 0, z: 0, heading: 0 };

export function sampleTour(elapsed: number, out: TourSample): TourSample {
  timeline ??= build();
  const lap = Math.floor(Math.max(0, elapsed) / timeline.cycle);
  const t = ((elapsed % timeline.cycle) + timeline.cycle) % timeline.cycle;
  const leg = timeline.legs.find((each) => t >= each.start && t < each.end) ?? timeline.legs[0]!;
  out.lap = lap;
  if (leg.kind === 'stay') {
    const stop = leg.stop;
    out.anchorX = stop.anchor.x;
    out.anchorZ = stop.anchor.z;
    out.yaw = stop.yaw;
    out.viewYaw = stop.yaw;
    out.heading = stop.yaw;
    out.moving = false;
    out.stop = stop.id;
    out.leaving = null;
    out.going = null;
    out.stopMs = t - leg.start;
    out.stopLeftMs = leg.end - t;
    const later = stop.later && lap > 0 && out.stopMs >= stop.later.from && out.stopMs < stop.later.to ? stop.later.word : null;
    out.word = later ?? stop.word;
    const envelope = Math.min(MathUtils.smoothstep(t - leg.start, 0, 900), MathUtils.smoothstep(leg.end - t, 0, 900));
    out.crane = stop.crane * envelope;
    out.over = (stop.over ?? 0) * envelope;
    out.lift = 0;
    return out;
  }
  const progress = (t - leg.start) / (leg.end - leg.start);
  const u = trapezoid(progress);
  alongRoute(leg.points, leg.count, u * leg.length, cursor);
  out.anchorX = cursor.x;
  out.anchorZ = cursor.z;
  const turnOut = MathUtils.smoothstep(u, 0, 0.12);
  const turnIn = MathUtils.smoothstep(u, 0.88, 1);
  out.yaw = lerpAngle(lerpAngle(leg.from.yaw, cursor.heading, turnOut), leg.to.yaw, turnIn);
  out.viewYaw = lerpAngle(leg.from.yaw, leg.to.yaw, MathUtils.smootherstep(u, 0.15, 0.85));
  out.heading = cursor.heading;
  out.moving = progress > 0.01 && progress < 0.99;
  out.lift = Math.min(MathUtils.smoothstep(progress, 0, 0.3), MathUtils.smoothstep(1 - progress, 0, 0.3));
  out.stop = null;
  out.leaving = leg.from.id;
  out.going = leg.to.id;
  out.stopMs = 0;
  out.stopLeftMs = 0;
  out.word = null;
  out.crane = 0;
  out.over = 0;
  return out;
}

export function makeTourSample(): TourSample {
  return { anchorX: HOME.x, anchorZ: HOME.z, yaw: 0, viewYaw: 0, heading: 0, crane: 0, over: 0, lift: 0, moving: false, stop: 'home', leaving: null, going: null, stopMs: 0, stopLeftMs: 0, word: null, lap: 0 };
}

export function awayFromHome(sample: TourSample) {
  return Math.hypot(sample.anchorX - HOME.x, sample.anchorZ - HOME.z);
}

export function placeInRow(sample: TourSample, x: number, z: number, out: { x: number; z: number }) {
  const squeeze = sample.moving ? 0.55 : 1;
  const localX = (x - HOME.x) * squeeze;
  const localZ = (z - HOME.z) * squeeze;
  const cos = Math.cos(sample.yaw);
  const sin = Math.sin(sample.yaw);
  out.x = sample.anchorX + localX * cos + localZ * sin;
  out.z = sample.anchorZ - localX * sin + localZ * cos;
  return out;
}

const home: Shot = { position: new Vector3(), target: new Vector3(), fov: 0 };
const solo: Shot = { position: new Vector3(), target: new Vector3(), fov: 0 };
const CRANED = { position: new Vector3(0, 9.6, 13.4), target: new Vector3(0, 0.2, 1.6) };
const OVER = { position: new Vector3(0, 11, 8), target: new Vector3(0, 0.5, -1.4) };
const LIFTED = { position: new Vector3(0, 11.5, 11), target: new Vector3(0, 0, -2.5) };

export function tourShot(aspect: number, count: number, sample: TourSample, out: Shot, demo: FloorPoint | null = null): Shot {
  lobbyShot(aspect, count, home);
  if (count > 1) {
    lobbyShot(aspect, 1, solo);
    const away = MathUtils.smoothstep(awayFromHome(sample), 0.5, 4);
    home.position.lerp(solo.position, away);
    home.target.lerp(solo.target, away);
  }
  const craned = CRANED;
  const k = sample.crane;
  const o = sample.over;
  const l = sample.lift;
  const lerp4 = (base: number, crane: number, over: number, lift: number) =>
    MathUtils.lerp(MathUtils.lerp(MathUtils.lerp(base, crane, k), over, o), lift, l);
  let px = lerp4(home.position.x - HOME.x, craned.position.x, OVER.position.x, LIFTED.position.x);
  const py = lerp4(home.position.y, craned.position.y, OVER.position.y, LIFTED.position.y);
  let pz = lerp4(home.position.z - HOME.z, craned.position.z, OVER.position.z, LIFTED.position.z);
  let tx = lerp4(home.target.x - HOME.x, craned.target.x, OVER.target.x, LIFTED.target.x);
  const ty = lerp4(home.target.y, craned.target.y, OVER.target.y, LIFTED.target.y);
  const tz = lerp4(home.target.z - HOME.z, craned.target.z, OVER.target.z, LIFTED.target.z);
  const cos = Math.cos(sample.viewYaw);
  const sin = Math.sin(sample.viewYaw);
  if (demo) {
    const dx = demo.x - sample.anchorX;
    const dz = demo.z - sample.anchorZ;
    const across = dx * cos - dz * sin;
    const lean = aspect < 1 ? 0.75 : 0.4;
    px += across * lean;
    tx += across * lean;
    pz += Math.abs(across) * 0.3;
  }
  out.position.set(sample.anchorX + px * cos + pz * sin, py, sample.anchorZ - px * sin + pz * cos);
  out.target.set(sample.anchorX + tx * cos + tz * sin, ty, sample.anchorZ - tx * sin + tz * cos);
  out.fov = home.fov;
  return out;
}

const EASE = 0.2;

function trapezoid(t: number) {
  const top = 1 / (1 - EASE);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < EASE) return (top * t * t) / (2 * EASE);
  if (t > 1 - EASE) return 1 - (top * (1 - t) * (1 - t)) / (2 * EASE);
  return top * (t - EASE / 2);
}

function lerpAngle(from: number, to: number, t: number) {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + diff * t;
}

export const tourFrame = {
  sample: makeTourSample(),
  demo: null as Demo | null,
  popIntro: false,
};

type Mode = 'lobby' | 'intro' | 'show' | 'outro' | 'replay';
let lastMode: Mode | null = null;

export function advanceTour(mode: Mode, parked: boolean, now: number) {
  const was = lastMode;
  lastMode = mode;
  if (mode === 'lobby') {
    tourFrame.popIntro = false;
    if (parked) {
      resetTour();
      sampleTour(0, tourFrame.sample);
      tourDemo(tourFrame.sample, tourFrame.demo ??= makeDemo());
      return;
    }
    sampleTour(tourClock(now), tourFrame.sample);
    tourDemo(tourFrame.sample, tourFrame.demo ??= makeDemo());
    return;
  }
  if (mode === 'intro') {
    if (was === 'lobby') tourFrame.popIntro = awayFromHome(tourFrame.sample) > 0.5;
    return;
  }
  resetTour();
  tourFrame.popIntro = false;
}

export type DemoGesture = 'grab' | 'feed' | 'place' | 'print';
export type DemoHeld = 'none' | 'plain' | 'treated';
export type Demo = {
  spot: FloorPoint | null;
  face: number;
  held: DemoHeld;
  gesture: DemoGesture | null;
  gestureMs: number;
  gestureKey: string | null;
};

export const DEMO_LAYER = 'BASS' as const;

type Beat = { at: number; gesture: DemoGesture };
type Place = { from: number; to: number; spot: FloorPoint; face: number };
type Visit = { places: Place[]; beats: Beat[] };

let visits: Partial<Record<StopId, Visit>> | null = null;

function toward(from: FloorPoint, to: FloorPoint, by: number): FloorPoint {
  const distance = Math.hypot(to.x - from.x, to.z - from.z) || 1;
  return { x: from.x + ((to.x - from.x) / distance) * by, z: from.z + ((to.z - from.z) / distance) * by };
}
const facing = (from: FloorPoint, to: FloorPoint) => Math.atan2(to.x - from.x, to.z - from.z);

function buildVisits(): Partial<Record<StopId, Visit>> {
  const centre = { x: 0, z: 0 };
  const crate = stationPosition(STATION_BY_ID[`st-rack-${DEMO_LAYER.toLowerCase()}`]!);
  const crateSpot = toward(crate, centre, 2.9);
  const press = stationPosition(STATION_BY_ID['st-crusher']!);
  const pressSpot = toward(press, centre, 2.7);
  const landed = pressLanding('st-crusher');
  const landedSpot = toward(landed, pressSpot, 1.1);
  const deckAngle = -0.42;
  const deckSpot = {
    x: DECK_POSITION.x + Math.sin(deckAngle) * (DECK_PLINTH_RADIUS + 0.75),
    z: DECK_POSITION.z + Math.cos(deckAngle) * (DECK_PLINTH_RADIUS + 0.75),
  };
  const printSpot = { x: 0, z: SONG_ARC_RADIUS - 1.14 };
  const T = DEMO_TIMES;
  return {
    racks: { places: [{ from: 450, to: 2700, spot: crateSpot, face: facing(crateSpot, crate) }], beats: [{ at: T.grab, gesture: 'grab' }] },
    machine: {
      places: [
        { from: 450, to: T.toLanding, spot: pressSpot, face: facing(pressSpot, press) },
        { from: T.toLanding, to: T.pressBack, spot: landedSpot, face: facing(landedSpot, landed) },
      ],
      beats: [{ at: T.feed, gesture: 'feed' }, { at: T.regrab, gesture: 'grab' }],
    },
    deck: { places: [{ from: 450, to: 2600, spot: deckSpot, face: facing(deckSpot, DECK_POSITION) }], beats: [{ at: T.place, gesture: 'place' }] },
    arc: { places: [{ from: 350, to: 3400, spot: printSpot, face: 0 }], beats: [{ at: T.print, gesture: 'print' }] },
  };
}

function heldAt(stop: StopId, ms: number): DemoHeld {
  const T = DEMO_TIMES;
  switch (stop) {
    case 'racks': return ms >= T.grab + HANDS_MS ? 'plain' : 'none';
    case 'machine': return ms < T.feed + HANDS_MS ? 'plain' : ms < T.regrab + HANDS_MS ? 'none' : 'treated';
    case 'deck': return ms < T.place + HANDS_MS ? 'treated' : 'none';
    default: return 'none';
  }
}

function heldBetween(leaving: StopId | null): DemoHeld {
  if (leaving === 'racks') return 'plain';
  if (leaving === 'machine') return 'treated';
  return 'none';
}

export function tourDemo(sample: TourSample, out: Demo): Demo {
  visits ??= buildVisits();
  out.spot = null;
  out.gesture = null;
  out.gestureMs = 0;
  out.gestureKey = null;
  if (!sample.stop) {
    out.held = heldBetween(sample.leaving);
    return out;
  }
  out.held = heldAt(sample.stop, sample.stopMs);
  const visit = visits[sample.stop];
  if (!visit) return out;
  const place = visit.places.find((each) => sample.stopMs >= each.from && sample.stopMs < each.to);
  if (place) {
    out.spot = place.spot;
    out.face = place.face;
  }
  for (let i = visit.beats.length - 1; i >= 0; i -= 1) {
    const beat = visit.beats[i]!;
    if (sample.stopMs < beat.at) continue;
    out.gesture = beat.gesture;
    out.gestureMs = beat.at;
    out.gestureKey = `${sample.lap}|${sample.stop}|${i}`;
    break;
  }
  return out;
}

export function makeDemo(): Demo {
  return { spot: null, face: 0, held: 'none', gesture: null, gestureMs: 0, gestureKey: null };
}

export type DemoProps = { held: DemoHeld; gesture: 'grab' | 'feed' | 'place' | null; gestureAt: number; printAt: number };

export const useDemoProps = create<DemoProps>(() => ({ held: 'none', gesture: null, gestureAt: 0, printAt: 0 }));

let playedKey: string | null = null;

export function publishDemo(demo: Demo | null, clock: number, stopMs: number) {
  const current = useDemoProps.getState();
  const held = demo?.held ?? 'none';
  let { gesture, gestureAt, printAt } = current;
  if (demo?.gestureKey && demo.gestureKey !== playedKey) {
    playedKey = demo.gestureKey;
    const late = stopMs - demo.gestureMs;
    const at = late < 600 ? clock - late : clock - 60_000;
    if (demo.gesture === 'print') printAt = at;
    else { gesture = demo.gesture; gestureAt = at; }
  }
  if (held !== current.held || gesture !== current.gesture || gestureAt !== current.gestureAt || printAt !== current.printAt) {
    useDemoProps.setState({ held, gesture, gestureAt, printAt });
  }
}
