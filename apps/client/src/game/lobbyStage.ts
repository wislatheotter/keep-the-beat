import { Frustum, Matrix4, Sphere, Vector3, type Camera } from 'three';
import { create } from 'zustand';
import {
  BLOCK_REST_Y,
  CRUSH_MS,
  EJECT_DISTANCE,
  PLATTER_Y,
  RACKS,
  STATION_BY_ID,
  blankFx,
  openingRecord,
  platterPosition,
  popOut,
  rackSlotPosition,
  samplesFor,
  songArcSlot,
  stationEjectDirection,
  stationExit,
  type BlockState,
  type GameEvent,
  type SampleRole,
  type ThemeId,
} from '@loop/shared';
import type { TourSample } from './lobbyTour';

export const DEMO_RECORD_ID = 'lobby-demo';
const OPENING_ID = 'lobby-opening';

export const DEMO_TIMES = {
  grab: 1500,
  feed: 1200,
  intoPress: 1340,
  toLanding: 3050,
  regrab: 3750,
  pressBack: 4250,
  place: 1500,
  lands: 2900,
  print: 1300,
} as const;
export const OUT_OF_PRESS = DEMO_TIMES.intoPress + CRUSH_MS;
export const HANDS_MS = 140;

type Stage = {
  record: BlockState | null;
  busy: { stationId: string; since: number; until: number } | null;
  landsAt: number;
  holdFrom: number;
  printed: boolean;
  takenAt: number;
};

export const useLobbyStage = create<Stage>(() => ({ record: null, busy: null, landsAt: 0, holdFrom: 0, printed: false, takenAt: 0 }));

export function openingOnDeck(themeId: ThemeId, seed: number): BlockState | null {
  const opening = openingRecord(themeId, seed);
  if (!opening) return null;
  return fakeRecord(OPENING_ID, opening.sampleName, 'DRUMS', 'deck', platterPosition('DRUMS'));
}

export function demoSample(themeId: ThemeId): string {
  return samplesFor(themeId, 'BASS')[0]?.sampleName ?? '';
}

export function crateRecords(themeId: ThemeId, takenAt: number): BlockState[] {
  return RACKS.flatMap((rack) => {
    const role = rack.role!;
    const sampleName = samplesFor(themeId, role)[0]?.sampleName;
    if (!sampleName) return [];
    const record = fakeRecord(`lobby-crate-${role}`, sampleName, role, 'racked', rackSlotPosition(rack, 0));
    record.rackId = rack.id;
    record.beacon = false;
    if (role === 'BASS') record.dealtAt = takenAt;
    return [record];
  });
}

export const DEMO_CRATE_RECORD_ID = 'lobby-crate-BASS';

function fakeRecord(id: string, sampleName: string, role: SampleRole, status: BlockState['status'], at: { x: number; y: number; z: number }): BlockState {
  return {
    id,
    sampleName,
    role,
    fx: blankFx(),
    status,
    position: { ...at },
    velocity: { x: 0, y: 0, z: 0 },
    holderId: null,
    stationId: null,
    rackId: null,
    slot: 0,
    layer: status === 'deck' ? role as BlockState['layer'] : null,
    dealtInSection: 0,
    dealtAt: 0,
    floorSince: 0,
    beacon: status !== 'deck',
  };
}

export function pressLanding(stationId: string) {
  const station = STATION_BY_ID[stationId]!;
  const from = stationExit(station);
  const direction = stationEjectDirection(station);
  return { x: from.x + direction.x * EJECT_DISTANCE, z: from.z + direction.z * EJECT_DISTANCE };
}

const fired = new Set<string>();
let deckKept = false;
let arcKept = false;
let lastLap = -1;
const frustum = new Frustum();
const projection = new Matrix4();
const sphere = new Sphere(new Vector3(), 1.4);

export function driveLobbyStage(
  sample: TourSample,
  themeId: ThemeId,
  clock: number,
  camera: Camera,
  fire: (event: GameEvent) => void,
) {
  if (sample.lap !== lastLap) {
    lastLap = sample.lap;
    fired.clear();
  }
  const ms = sample.stopMs;
  const key = (name: string) => `${sample.stop}|${name}`;
  const once = (name: string, at: number, run: () => void) => {
    if (ms < at || fired.has(key(name))) return;
    fired.add(key(name));
    if (ms - at < 400) run();
  };
  const since = (at: number) => clock - (ms - at);
  const event = (fields: Record<string, unknown>) => ({ id: `lobby-${sample.lap}-${sample.stop}-${String(fields.type)}`, at: clock, ...fields }) as GameEvent;
  const sampleName = demoSample(themeId);
  const next: Partial<Stage> = {};

  camera.updateMatrixWorld();
  projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projection);
  const current = useLobbyStage.getState();
  if (deckKept && sample.stop !== 'deck') {
    const at = platterPosition('BASS');
    sphere.center.set(at.x, PLATTER_Y, at.z);
    if (!frustum.intersectsSphere(sphere)) {
      deckKept = false;
      if (current.record?.status === 'deck') next.record = null;
    }
  }
  if (arcKept && sample.stop !== 'arc') {
    const at = songArcSlot(0);
    sphere.center.set(at.x, 1.8, at.z);
    if (!frustum.intersectsSphere(sphere)) {
      arcKept = false;
      next.printed = false;
    }
  }

  switch (sample.stop) {
    case 'racks': {
      once('taken', DEMO_TIMES.grab + HANDS_MS, () => {
        next.takenAt = clock;
        fire(event({ type: 'taken', name: '', role: 'BASS', rackId: 'st-rack-bass' }));
      });
      break;
    }
    case 'machine': {
      const press = 'st-crusher';
      if (ms >= DEMO_TIMES.intoPress && ms < OUT_OF_PRESS) {
        if (current.record?.status !== 'station') {
          next.record = { ...fakeRecord(DEMO_RECORD_ID, sampleName, 'BASS', 'station', stationExit(STATION_BY_ID[press]!)), stationId: press, beacon: false };
          next.busy = { stationId: press, since: since(DEMO_TIMES.intoPress), until: since(DEMO_TIMES.intoPress) + CRUSH_MS };
        }
      } else if (ms >= OUT_OF_PRESS && ms < DEMO_TIMES.regrab + HANDS_MS) {
        if (current.record?.status !== 'thrown') {
          const record = fakeRecord(DEMO_RECORD_ID, sampleName, 'BASS', 'thrown', { x: 0, y: 0, z: 0 });
          popOut(record, STATION_BY_ID[press]!);
          record.fx = { ...record.fx, crush: true };
          record.floorSince = clock;
          next.record = record;
          next.busy = null;
        }
        once('processed', OUT_OF_PRESS, () => fire(event({ type: 'processed', fx: 'crush', kind: 'crusher', name: '', stationId: press })));
      } else if (current.record || current.busy) {
        next.record = null;
        next.busy = null;
      }
      break;
    }
    case 'deck': {
      if (ms >= DEMO_TIMES.place + HANDS_MS) {
        deckKept = true;
        if (current.record?.status !== 'deck') {
          const record = fakeRecord(DEMO_RECORD_ID, sampleName, 'BASS', 'deck', platterPosition('BASS'));
          record.fx = { ...record.fx, crush: true };
          next.record = record;
          next.landsAt = since(DEMO_TIMES.lands);
        }
        once('dropped', DEMO_TIMES.lands, () => fire(event({ type: 'dropped', layers: ['BASS'], coordinated: false })));
      }
      break;
    }
    case 'arc': {
      if (ms >= DEMO_TIMES.print && current.holdFrom === 0 && !current.printed) next.holdFrom = since(DEMO_TIMES.print);
      once('printed', DEMO_TIMES.print + 700, () => {
        arcKept = true;
        next.printed = true;
        next.holdFrom = 0;
        fire(event({ type: 'section-printed', index: 0, name: 'INTRO', score: 800, bars: 8, playerId: null }));
      });
      break;
    }
    default:
      break;
  }

  if (Object.keys(next).length) useLobbyStage.setState(next);
}

export function clearLobbyStage() {
  deckKept = false;
  arcKept = false;
  lastLap = -1;
  fired.clear();
  const current = useLobbyStage.getState();
  if (current.record || current.busy || current.printed || current.holdFrom || current.takenAt) {
    useLobbyStage.setState({ record: null, busy: null, landsAt: 0, holdFrom: 0, printed: false, takenAt: 0 });
  }
}

export function lobbyCharge(now: number) {
  const { holdFrom } = useLobbyStage.getState();
  if (!holdFrom) return 0;
  return Math.min(1, Math.max(0, (now - holdFrom) / 700));
}

export const FLOOR_Y = BLOCK_REST_Y;
