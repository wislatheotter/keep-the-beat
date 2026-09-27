export type LoopLayer = 'DRUMS' | 'BASS' | 'MUSIC' | 'TOPS';

export type SampleRole = LoopLayer | 'SPECIAL';

export const LOOP_LAYERS: LoopLayer[] = ['DRUMS', 'BASS', 'MUSIC', 'TOPS'];

export type GameSample = {
  sampleName: string;
  uuid: string;
  name: string;
  sourceName: string;
  role: SampleRole;
  family: string;
  pack: string;
  packLabel: string;
  cluster: string;
  keySig: number | null;
  tuneCents: number;
  shift: [number, number];
  transform: 'resample' | 'stretch';
  clash: number[];
  bars: number;
  sourceBpm: number;
  tempoMultiple: number;
  key: string | null;
  gainDb: number;
  energy: number;
  bright: number;
  busy: number;
  rmsDb: number;
  peakDb: number;
  bands: [number, number, number, number];
  onsets: number;
  numUsages: number;
  loops?: number;
};

export type ThemeKit = {
  id: string;
  label: string;
  blurb: string;
  bpm: number;
  keys: Array<{ sig: number; weight: number }>;
  samples: GameSample[];
};

export const isOneShot = (sample: GameSample) => sample.bars === 0;

export const authoredBpm = (sample: GameSample) => sample.sourceBpm * (sample.tempoMultiple || 1);
