import type { FxId } from './types.js';

export const MACHINE_BANDS: Partial<Record<FxId, number[]>> = {
  space: [0.81, 0.99, 1.0, 0.905],
  wide: [1.005, 0.987, 0.947, 0.843],
  swirl: [1.166, 0.636, 0.553, 1.043],
  warp: [1.088, 1.191, 1.182, 1.086],
};
