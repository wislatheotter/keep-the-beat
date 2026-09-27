import { MathUtils } from 'three';

const FRAMING = {
  fov: 44,
  depth: 16.5,
  pitchDegrees: 37,
  lookAhead: 3.6,
};

export type CameraFraming = {
  fov: number;
  height: number;
  depth: number;
  lookAhead: number;
};

const PORTRAIT_PULLBACK = 0.2;
const PORTRAIT_ASPECT = 0.46;

const DISTANCE = FRAMING.depth / (2 * Math.tan((FRAMING.fov * MathUtils.DEG2RAD) / 2));
const PITCH = FRAMING.pitchDegrees * MathUtils.DEG2RAD;

const FOLLOW: CameraFraming = { fov: FRAMING.fov, height: 0, depth: 0, lookAhead: FRAMING.lookAhead };

export function portraitPullback(aspect: number) {
  return 1 + PORTRAIT_PULLBACK * MathUtils.clamp((1 - aspect) / (1 - PORTRAIT_ASPECT), 0, 1);
}

export function portraitReach(aspect: number) {
  return DISTANCE * (portraitPullback(aspect) - 1);
}

export function cameraFraming(aspect: number): CameraFraming {
  const distance = DISTANCE * portraitPullback(aspect);
  FOLLOW.height = distance * Math.sin(PITCH);
  FOLLOW.depth = distance * Math.cos(PITCH);
  return FOLLOW;
}
