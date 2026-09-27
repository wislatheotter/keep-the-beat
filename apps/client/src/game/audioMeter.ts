import { LOOP_LAYERS, type GameState, type LoopLayer } from '@loop/shared';
import { loopEngine, VISUAL_BANDS, type VisualLevels } from '../audio/LoopEngine';
import type { BeatInfo } from './beat';

export type AudioFrame = VisualLevels & {
  measured: boolean;
};

const synthetic: AudioFrame = {
  bands: new Float32Array(VISUAL_BANDS),
  levels: { DRUMS: 0, BASS: 0, MUSIC: 0, TOPS: 0 },
  low: 0,
  loudness: 0,
  measured: false,
};
const measured: AudioFrame = { ...synthetic, bands: new Float32Array(VISUAL_BANDS), levels: { ...synthetic.levels }, measured: true };

let lastFrame = -1;
let last: AudioFrame = synthetic;

const SHAPE: Record<LoopLayer, (band: number) => number> = {
  DRUMS: (b) => Math.exp(-((b - 1) ** 2) / 3) + Math.exp(-((b - 11) ** 2) / 10) * 0.5,
  BASS: (b) => Math.exp(-((b - 2) ** 2) / 4),
  MUSIC: (b) => Math.exp(-((b - 7) ** 2) / 10),
  TOPS: (b) => Math.exp(-((b - 13) ** 2) / 6),
};

export function audioFrame(state: GameState, beat: BeatInfo, frame: number): AudioFrame {
  if (frame === lastFrame) return last;
  lastFrame = frame;
  const real = loopEngine.visualLevels();
  if (real) {
    measured.bands.set(real.bands);
    for (const layer of LOOP_LAYERS) measured.levels[layer] = real.levels[layer];
    measured.low = real.low;
    measured.loudness = real.loudness;
    last = measured;
    return last;
  }
  const step = beat.stepPulse;
  const envelope: Record<LoopLayer, number> = {
    DRUMS: 0.35 + beat.pulse * 0.65,
    BASS: 0.55 + beat.pulse * 0.35,
    MUSIC: 0.6 + Math.sin(beat.beatPhase * Math.PI) * 0.15,
    TOPS: 0.3 + step * 0.6,
  };
  synthetic.bands.fill(0);
  let loudness = 0;
  for (const layer of LOOP_LAYERS) {
    const on = state.song.layers[layer].sampleName ? 1 : 0;
    const level = on * envelope[layer];
    synthetic.levels[layer] = level;
    for (let band = 0; band < VISUAL_BANDS; band += 1) {
      synthetic.bands[band] = Math.min(1, synthetic.bands[band]! + SHAPE[layer](band) * level * 0.8);
    }
  }
  for (let band = 0; band < VISUAL_BANDS; band += 1) loudness += synthetic.bands[band]!;
  synthetic.low = (synthetic.bands[0]! + synthetic.bands[1]! + synthetic.bands[2]!) / 3;
  synthetic.loudness = loudness / VISUAL_BANDS;
  last = synthetic;
  return last;
}
