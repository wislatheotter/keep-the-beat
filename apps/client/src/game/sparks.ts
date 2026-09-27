import { Color } from 'three';
import type { Vec3 } from '@loop/shared';
import { PERFORMANCE } from './performance';

export type Spark = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: Color;
};

export const SPARK_COUNT = PERFORMANCE.sparkCount;

export const sparks: Spark[] = Array.from({ length: SPARK_COUNT }, () => ({
  x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, color: new Color(),
}));

let cursor = 0;

export type BurstOptions = {
  count?: number;
  speed?: number;
  lift?: number;
  spread?: number;
  life?: number;
  size?: number;
};

export function emitBurst(at: Vec3, color: string | Color, options: BurstOptions = {}) {
  const {
    count = 14,
    speed = 3.4,
    lift = 2.2,
    spread = 0.55,
    life = 0.55,
    size = 1,
  } = options;
  const tint = color instanceof Color ? color : new Color(color);
  const budget = Math.min(count, Math.floor(SPARK_COUNT / 3));

  for (let i = 0; i < budget; i += 1) {
    const spark = sparks[cursor]!;
    cursor = (cursor + 1) % SPARK_COUNT;
    const angle = Math.random() * Math.PI * 2;
    const pitch = (Math.random() - 0.5) * spread;
    const velocity = speed * (0.55 + Math.random() * 0.75);
    spark.x = at.x;
    spark.y = at.y;
    spark.z = at.z;
    spark.vx = Math.sin(angle) * Math.cos(pitch) * velocity;
    spark.vz = Math.cos(angle) * Math.cos(pitch) * velocity;
    spark.vy = lift * (0.5 + Math.random());
    spark.maxLife = life * (0.7 + Math.random() * 0.6);
    spark.life = spark.maxLife;
    spark.size = size * (0.65 + Math.random() * 0.7);
    spark.color.copy(tint);
  }
}

export function clearSparks() {
  for (const spark of sparks) spark.life = 0;
}
