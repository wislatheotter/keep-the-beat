import { LOOP_LAYERS, sample, type LoopLayer } from './themes.js';
import { FX_IDS } from './types.js';
import type { FxId, FxSet } from './types.js';
import { MIX_MODEL } from './mixModel.generated.js';
import { MACHINE_BANDS } from './machineBands.js';

export type Quantiles = Partial<Record<'p05' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p95', number>>;

export type ThemeMixStats = {
  loudness: Quantiles;
  loudnessByLayers: Record<string, Quantiles>;
  lowShare: Quantiles;
  highShare: Quantiles;
  dominance: Quantiles;
  crestDb: Quantiles;
};

export type MixModelData = {
  analysisSampleRate: number;
  loudnessCorrectionDb: number;
  loudnessErrorDb: { median: number; p90: number };
  bandShareError: { median: number; p90: number };
  loudnessCorrelation: number;
  masterGainDb: number;
  hotLoudnessDb: number;
  fx: Partial<Record<FxId, number[]>>;
  themes: Record<string, ThemeMixStats>;
};

export type Bands = [number, number, number, number];

export type MixReading = {
  loudnessDb: number;
  shares: Bands;
  limitingDb: number;
  source: 'measured' | 'model';
};

export type MixLayer = { sampleName: string | null; fx: FxSet };

export type MixPrediction = MixReading & {
  dominance: number;
  loudest: LoopLayer | null;
  layers: number;
};

export function themeMixStats(themeId: string): ThemeMixStats | null {
  return MIX_MODEL.themes[themeId] ?? null;
}

export function predictMix(themeId: string, layers: Record<LoopLayer, MixLayer>): MixPrediction {
  const bands: Bands = [0, 0, 0, 0];
  let loudest: LoopLayer | null = null;
  let loudestPower = 0;
  let total = 0;
  let count = 0;
  for (const layer of LOOP_LAYERS) {
    const entry = sample(layers[layer].sampleName, themeId);
    if (!entry) continue;
    count += 1;
    const level = 10 ** ((entry.rmsDb + entry.gainDb) / 10);
    const sum = entry.bands.reduce((a, b) => a + b, 0) || 1;
    let power = 0;
    for (let band = 0; band < 4; band += 1) {
      let gain = 1;
      for (const fx of FX_IDS) {
        if (layers[layer].fx[fx]) gain *= MIX_MODEL.fx[fx]?.[band] ?? MACHINE_BANDS[fx]?.[band] ?? 1;
      }
      const value = level * (entry.bands[band]! / sum) * gain;
      bands[band] += value;
      power += value;
    }
    total += power;
    if (power > loudestPower) { loudestPower = power; loudest = layer; }
  }
  const loudnessDb = total > 0 ? 10 * Math.log10(total) + MIX_MODEL.loudnessCorrectionDb : -90;
  const crest = themeMixStats(themeId)?.crestDb.p50 ?? 14.5;
  const overshoot = loudnessDb + crest + MIX_MODEL.masterGainDb - LIMIT_THRESHOLD_DB;
  return {
    loudnessDb,
    shares: total > 0 ? bands.map((value) => value / total) as Bands : [0, 0, 0, 0],
    limitingDb: Math.max(0, overshoot),
    source: 'model',
    dominance: total > 0 ? loudestPower / total : 0,
    loudest,
    layers: count,
  };
}

export const LIMIT_THRESHOLD_DB = -3;

export function loudnessPercentile(themeId: string, loudnessDb: number): number {
  const stats = themeMixStats(themeId);
  if (!stats) return 0.5;
  const points: Array<[number, number]> = (['p05', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95'] as const)
    .filter((key) => stats.loudness[key] !== undefined)
    .map((key) => [Number(key.slice(1)) / 100, stats.loudness[key]!]);
  if (points.length === 0) return 0.5;
  if (loudnessDb <= points[0]![1]) return Math.max(0, points[0]![0] - (points[0]![1] - loudnessDb) * 0.02);
  for (let i = 1; i < points.length; i += 1) {
    const [q0, v0] = points[i - 1]!;
    const [q1, v1] = points[i]!;
    if (loudnessDb <= v1) return q0 + (q1 - q0) * ((loudnessDb - v0) / Math.max(1e-6, v1 - v0));
  }
  const [qLast, vLast] = points[points.length - 1]!;
  return Math.min(1, qLast + (loudnessDb - vLast) * 0.02);
}

export function plausibleReading(reading: unknown): MixReading | null {
  if (!reading || typeof reading !== 'object') return null;
  const value = reading as Partial<MixReading>;
  if (typeof value.loudnessDb !== 'number' || !Number.isFinite(value.loudnessDb)) return null;
  if (value.loudnessDb < -45 || value.loudnessDb > 0) return null;
  if (!Array.isArray(value.shares) || value.shares.length !== 4) return null;
  const shares = value.shares.map((share) => Number(share));
  if (shares.some((share) => !Number.isFinite(share) || share < 0 || share > 1)) return null;
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum < 0.8 || sum > 1.2) return null;
  const limitingDb = typeof value.limitingDb === 'number' && Number.isFinite(value.limitingDb)
    ? Math.min(24, Math.max(0, value.limitingDb))
    : 0;
  return { loudnessDb: value.loudnessDb, shares: shares.map((share) => share / sum) as Bands, limitingDb, source: 'measured' };
}

export function mixSignature(layers: Record<LoopLayer, MixLayer>): string {
  return LOOP_LAYERS.map((layer) => {
    const entry = layers[layer];
    if (!entry.sampleName) return '-';
    const fx = FX_IDS.filter((id) => entry.fx[id]).map((id) => id[0]).join('');
    return `${entry.sampleName.slice(-8)}${fx ? `+${fx}` : ''}`;
  }).join('|');
}
