import type { GameSample, LoopLayer } from './themeTypes.js';

export type TransformMode = 'resample' | 'stretch';

export type LoopPlan = {
  mode: TransformMode;
  semitones: number;
  sourceSeconds: number;
  outSeconds: number;
};

const MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR = ['A', 'Bb', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

export const keyLabel = (sig: number) => `${MAJOR[((sig % 12) + 12) % 12]} major / ${MINOR[((sig % 12) + 12) % 12]} minor`;
export const keyShortLabel = (sig: number) => `${MINOR[((sig % 12) + 12) % 12]}m`;

export function shiftFor(sample: Pick<GameSample, 'keySig' | 'shift'>, sig: number | null): number | null {
  if (sample.keySig === null || sig === null) return 0;
  const base = (((sig - sample.keySig) % 12) + 12) % 12;
  const [lo, hi] = sample.shift;
  let best: number | null = null;
  for (const candidate of [base - 12, base, base + 12]) {
    if (candidate < lo || candidate > hi) continue;
    if (best === null || Math.abs(candidate) < Math.abs(best)) best = candidate;
  }
  return best;
}

export const fitsKey = (sample: Pick<GameSample, 'keySig' | 'shift'>, sig: number | null) => shiftFor(sample, sig) !== null;

export function sourceSeconds(sample: Pick<GameSample, 'bars' | 'tempoMultiple' | 'sourceBpm'>): number {
  const sourceBeats = (sample.bars * 4) / (sample.tempoMultiple || 1);
  return (sourceBeats * 60) / sample.sourceBpm;
}

export function loopPlan(sample: GameSample, themeBpm: number, sig: number | null): LoopPlan {
  const out = (sample.bars * 4 * 60) / themeBpm;
  const source = sourceSeconds(sample);
  if (sample.transform === 'stretch') {
    const shift = shiftFor(sample, sig) ?? 0;
    return { mode: 'stretch', semitones: round3(shift - sample.tuneCents / 100), sourceSeconds: source, outSeconds: out };
  }
  return { mode: 'resample', semitones: round3(12 * Math.log2(source / Math.max(1e-9, out))), sourceSeconds: source, outSeconds: out };
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export const LAYER_LOW_CUT_HZ: Record<LoopLayer, number> = {
  DRUMS: 0,
  BASS: 0,
  MUSIC: 120,
  TOPS: 160,
};
