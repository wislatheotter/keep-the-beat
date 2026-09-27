import { PERFORMANCE } from './performance';

export type DustBall = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
  size: number;
};

export const DUST_COLOR = '#f1f3f8';

export const DUST_BALL_COUNT = PERFORMANCE.tier === 'low' ? 36 : 72;

export const dustBalls: DustBall[] = Array.from({ length: DUST_BALL_COUNT }, () => ({
  x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0,
}));

let cursor = 0;

export type FootfallOptions = {
  x: number; y: number; z: number;
  dirX: number; dirZ: number;
  energy: number;
  scale?: number;
};

const PUFF: ReadonlyArray<readonly [back: number, side: number, up: number, size: number]> = [
  [0.12, 0, 0.12, 1],
  [0.24, -0.12, 0.08, 0.75],
  [0.2, 0.12, 0.2, 0.65],
];

export function emitFootfall({ x, y, z, dirX, dirZ, energy, scale = 1 }: FootfallOptions) {
  const e = Math.max(0, Math.min(1, energy));
  const big = (0.18 + e * 0.05) * scale;
  const flip = Math.random() < 0.5 ? -1 : 1;
  for (const [back, side, up, share] of PUFF) {
    const ball = dustBalls[cursor]!;
    cursor = (cursor + 1) % DUST_BALL_COUNT;
    const across = side * flip;
    ball.x = x + (-dirX * back + dirZ * across) * scale;
    ball.y = y + up * scale;
    ball.z = z + (-dirZ * back - dirX * across) * scale;
    ball.vx = (-dirX * 0.7 + dirZ * across * 0.6) * scale;
    ball.vy = (0.45 + Math.random() * 0.2) * scale;
    ball.vz = (-dirZ * 0.7 - dirX * across * 0.6) * scale;
    ball.life = ball.maxLife = 0.36 + Math.random() * 0.08;
    ball.size = big * share * (0.9 + Math.random() * 0.2);
  }
}
