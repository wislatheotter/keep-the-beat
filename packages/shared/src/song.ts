import { clamp } from './math.js';
import { LOOP_LAYERS, sample, theme, type LoopLayer, type ThemeId } from './themes.js';
import { FX_IDS, blankFx } from './types.js';
import type { FxSet } from './types.js';
import type { EvaluationLine } from './evaluate.js';
import type { MixReading } from './mix.js';

export const BEATS_PER_BAR = 4;

export const PHRASE_BARS = 2;

export const QUEUE_LEAD_BARS = 0.35;

export const barDurationMs = (bpm: number) => (BEATS_PER_BAR * 60_000) / bpm;

export function barPosition(transportStartedAt: number | null, bpm: number, now: number) {
  if (!transportStartedAt) return 0;
  return (now - transportStartedAt) / barDurationMs(bpm);
}

export const SILENT_LEAD_MS = 250;

export function nextPhraseBar(transportStartedAt: number | null, bpm: number, now: number, phaseBar = 0) {
  const position = barPosition(transportStartedAt, bpm, now) - phaseBar;
  return phaseBar + Math.max(PHRASE_BARS, Math.ceil((position + QUEUE_LEAD_BARS) / PHRASE_BARS) * PHRASE_BARS);
}

export function nextBeatBar(transportStartedAt: number | null, bpm: number, now: number) {
  const position = barPosition(transportStartedAt, bpm, now + SILENT_LEAD_MS);
  return Math.max(0, Math.ceil(position * BEATS_PER_BAR) / BEATS_PER_BAR);
}

export function barToTime(transportStartedAt: number | null, bpm: number, bar: number) {
  if (!transportStartedAt) return 0;
  return transportStartedAt + bar * barDurationMs(bpm);
}

export type SectionGoal = {
  name: string;
  hint: string;
  songBars: number;
  minLayers?: number;
  maxLayers?: number;
  intensity: [number, number];
  lift: [number, number] | null;
  peak?: boolean;
  brightLift?: boolean;
};

export const SECTION_PLAN: SectionGoal[] = [
  { name: 'INTRO', hint: 'Sparse and quiet — two things at most. Leave room to grow.', songBars: 8, maxLayers: 2, intensity: [0, 0.4], lift: null },
  { name: 'GROOVE', hint: 'Three or more running, and a step up from the intro.', songBars: 16, minLayers: 3, intensity: [0.3, 0.75], lift: [1.5, 6] },
  { name: 'BUILD', hint: 'Lift it — louder or brighter than the groove. Treat something.', songBars: 8, minLayers: 3, intensity: [0.45, 0.9], lift: [1, 4], brightLift: true },
  { name: 'DROP', hint: 'All four, the loudest section of the track.', songBars: 16, minLayers: 4, intensity: [0.65, 1], lift: [0, 4], peak: true },
  { name: 'OUTRO', hint: 'Strip it back — two layers, clearly quieter than the drop.', songBars: 8, maxLayers: 2, intensity: [0, 0.5], lift: [-8, -1.5] },
];

export const SECTION_COUNT = SECTION_PLAN.length;

export const FULL_SONG_BARS = SECTION_PLAN.reduce((total, goal) => total + goal.songBars, 0);

export const songBarsFor = (sectionIndex: number) =>
  SECTION_PLAN[Math.min(sectionIndex, SECTION_COUNT - 1)]!.songBars;

export type ActiveLayer = {
  sampleName: string | null;
  fx: FxSet;
  blockId: string | null;
  startedAtBar: number;
  changedBy: string | null;
};

export type QueuedChange = {
  id: string;
  layer: LoopLayer;
  sampleName: string | null;
  blockId: string | null;
  fx: FxSet;
  atBar: number;
  byPlayerId: string;
};

export type CommittedSection = {
  index: number;
  name: string;
  startBar: number;
  endBar: number;
  layers: Record<LoopLayer, { sampleName: string | null; fx: FxSet }>;
  score: number;
  evaluation: EvaluationLine[];
  mix: MixReading;
  printedBy: string | null;
  changes: number;
  coordinated: number;
  authoredMs: number;
};

export type Reward = {
  id: string;
  at: number;
  playerId: string | null;
  layer: LoopLayer | null;
  kind: 'land' | 'treated' | 'together' | 'print';
};

export type SongState = {
  themeId: ThemeId;
  bpm: number;
  sectionIndex: number;
  sectionStartBar: number;
  sectionStartedAt: number;
  layers: Record<LoopLayer, ActiveLayer>;
  queued: QueuedChange[];
  phaseBar: number;
  committed: CommittedSection[];
  sectionChanges: number;
  sectionCoordinated: number;
  baseline: Record<LoopLayer, { sampleName: string | null; fx: FxSet }>;
  sectionSounded: string[];
  sectionLandings: Partial<Record<LoopLayer, number>>;
  rewards: Reward[];
  energy: number;
  energyAt: number;
  surgeUntil: number;
  distinctSamples: string[];
};

const emptyFx = blankFx;

export const emptyLayers = (): Record<LoopLayer, { sampleName: string | null; fx: FxSet }> =>
  Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, { sampleName: null, fx: emptyFx() }])) as Record<LoopLayer, { sampleName: string | null; fx: FxSet }>;

export function snapshotLayers(song: SongState): Record<LoopLayer, { sampleName: string | null; fx: FxSet }> {
  return Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, {
    sampleName: song.layers[layer].sampleName,
    fx: { ...song.layers[layer].fx },
  }])) as Record<LoopLayer, { sampleName: string | null; fx: FxSet }>;
}

export function createSongState(themeId: ThemeId): SongState {
  const kit = theme(themeId);
  const layers = Object.fromEntries(
    LOOP_LAYERS.map((layer) => [layer, {
      sampleName: null, fx: emptyFx(), blockId: null, startedAtBar: 0, changedBy: null,
    } satisfies ActiveLayer]),
  ) as Record<LoopLayer, ActiveLayer>;
  return {
    themeId: kit.id,
    bpm: kit.bpm,
    sectionIndex: 0,
    sectionStartBar: 0,
    sectionStartedAt: 0,
    layers,
    queued: [],
    phaseBar: 0,
    committed: [],
    sectionChanges: 0,
    sectionCoordinated: 0,
    baseline: emptyLayers(),
    sectionSounded: [],
    sectionLandings: {},
    rewards: [],
    energy: 0.35,
    energyAt: 0,
    surgeUntil: 0,
    distinctSamples: [],
  };
}

export function activeLayerCount(song: SongState) {
  return LOOP_LAYERS.filter((layer) => song.layers[layer].sampleName !== null).length;
}

export function mixEnergy(song: Pick<SongState, 'layers'>) {
  return layersEnergy(song.layers);
}

export const ENERGY_RATE = 1.6;

export function songEnergy(song: Pick<SongState, 'energy' | 'energyAt' | 'layers'>, now: number) {
  const elapsed = (now - song.energyAt) / 1000;
  if (!(elapsed > 0)) return song.energy;
  const target = mixEnergy(song);
  return clamp(target + (song.energy - target) * Math.exp(-ENERGY_RATE * Math.min(elapsed, 60)), 0, 1);
}

export function layersEnergy(layers: Record<LoopLayer, { sampleName: string | null }>) {
  let total = 0;
  for (const layer of LOOP_LAYERS) {
    const entry = sample(layers[layer].sampleName);
    if (entry) total += 0.14 + entry.energy * 0.16 + entry.busy * 0.07;
  }
  return clamp(total, 0, 1);
}


export function songCursorBar(song: SongState) {
  return song.committed.length > 0 ? song.committed[song.committed.length - 1]!.endBar : 0;
}

export const LANDINGS_PER_LAYER = 2;
export const REWARD_RING = 12;

export type SongRegion = {
  layer: LoopLayer;
  sampleName: string;
  startBar: number;
  endBar: number;
  fx: FxSet;
};

export function songRegions(sections: CommittedSection[]): SongRegion[] {
  const regions: SongRegion[] = [];
  const open = new Map<LoopLayer, SongRegion>();

  for (const section of sections) {
    for (const layer of LOOP_LAYERS) {
      const entry = section.layers[layer];
      const current = open.get(layer);
      const sameAsOpen = current
        && current.sampleName === entry.sampleName
        && FX_IDS.every((fx) => current.fx[fx] === entry.fx[fx]);
      if (sameAsOpen) {
        current.endBar = section.endBar;
        continue;
      }
      if (current) open.delete(layer);
      if (!entry.sampleName) continue;
      const region: SongRegion = {
        layer,
        sampleName: entry.sampleName,
        startBar: section.startBar,
        endBar: section.endBar,
        fx: { ...entry.fx },
      };
      regions.push(region);
      open.set(layer, region);
    }
  }

  return regions.sort((a, b) => a.startBar - b.startBar);
}

export const songLengthBars = (sections: CommittedSection[]) =>
  sections.reduce((max, section) => Math.max(max, section.endBar), 0);
