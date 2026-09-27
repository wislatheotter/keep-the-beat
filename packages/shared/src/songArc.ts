import { SECTION_COUNT } from './song.js';
import type { Vec3 } from './types.js';

export const SONG_ARC_RADIUS = 16.35;
export const SONG_ARC_HALF_ANGLE = 0.44;
export const SONG_ARC_USE_RADIUS = 2.8;
export const SONG_ARC_COLLISION_RADIUS = 1.12;

export function songArcSlot(index: number, count = SECTION_COUNT): Vec3 {
  const angle = count <= 1 ? 0 : (index / (count - 1) * 2 - 1) * 0.36;
  return { x: Math.sin(angle) * SONG_ARC_RADIUS, y: 1.4, z: Math.cos(angle) * SONG_ARC_RADIUS };
}

export function songArcNearestPoint(position: Vec3): Vec3 {
  const angle = Math.max(-SONG_ARC_HALF_ANGLE, Math.min(SONG_ARC_HALF_ANGLE, Math.atan2(position.x, position.z)));
  return { x: Math.sin(angle) * SONG_ARC_RADIUS, y: 0, z: Math.cos(angle) * SONG_ARC_RADIUS };
}

export function songArcDistance(position: Vec3): number {
  const at = songArcNearestPoint(position);
  return Math.hypot(position.x - at.x, position.z - at.z);
}

export const isAtSongArc = (position: Vec3) => songArcDistance(position) <= SONG_ARC_USE_RADIUS;

export function avoidSongArc(position: Vec3): Vec3 {
  const at = songArcNearestPoint(position);
  const dx = position.x - at.x, dz = position.z - at.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= SONG_ARC_COLLISION_RADIUS) return position;
  const pastEnd = Math.abs(Math.atan2(position.x, position.z)) > SONG_ARC_HALF_ANGLE;
  const inward = distance < 0.001 || (!pastEnd && dx * at.x + dz * at.z >= 0);
  const nx = inward ? -at.x / SONG_ARC_RADIUS : dx / distance;
  const nz = inward ? -at.z / SONG_ARC_RADIUS : dz / distance;
  return { ...position, x: at.x + nx * SONG_ARC_COLLISION_RADIUS, z: at.z + nz * SONG_ARC_COLLISION_RADIUS };
}
