import {
  BLOCK_RADIUS_LIMIT,
  BLOCK_REST_Y,
  DECK_CATCH_RADIUS,
  DECK_POSITION,
  EJECT_INWARD,
  PLATTER_BEARING,
  PLATTER_RADIUS,
  PLATTER_Y,
  RACK_STACK_FORWARD,
  RACK_STACK_STEP,
  RACK_STACK_Y,
  STATIONS,
  STATION_BODY_HALF,
  STATION_BODY_RADIUS,
  STATION_RELEASE_Y,
  FALL_ACCEL,
  LOB_ELEVATION_DEG,
  MACHINE_CATCH_MARGIN,
  MACHINE_CATCH_Y,
  TUNNEL_HALF,
  type StationDefinition,
} from './constants.js';
import { LOOP_LAYERS, type LoopLayer } from './themes.js';
import type { Vec3 } from './types.js';

export const distanceXZ = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const normalizeXZ = (v: Vec3): Vec3 => {
  const len = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / len, y: 0, z: v.z / len };
};
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });
export const copyVec = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

export function clampToStage<T extends Vec3>(position: T, limit = BLOCK_RADIUS_LIMIT): T {
  const distance = Math.hypot(position.x, position.z);
  if (distance <= limit || distance === 0) return position;
  const k = limit / distance;
  position.x *= k;
  position.z *= k;
  return position;
}

export const platterAngle = (layer: LoopLayer) => PLATTER_BEARING[layer] * Math.PI * 2;

export const deckDistance = (position: Vec3) => Math.hypot(position.x - DECK_POSITION.x, position.z - DECK_POSITION.z);

export function platterOffset(layer: LoopLayer, radius = PLATTER_RADIUS): Vec3 {
  const angle = platterAngle(layer);
  return { x: Math.sin(angle) * radius, y: PLATTER_Y, z: Math.cos(angle) * radius };
}

export function platterPosition(layer: LoopLayer, radius = PLATTER_RADIUS): Vec3 {
  const offset = platterOffset(layer, radius);
  return { x: DECK_POSITION.x + offset.x, y: offset.y, z: DECK_POSITION.z + offset.z };
}

export function nearestPlatter(position: Vec3): LoopLayer {
  let best: LoopLayer = LOOP_LAYERS[0]!;
  let bestDistance = Infinity;
  for (const layer of LOOP_LAYERS) {
    const distance = distanceXZ(position, platterPosition(layer));
    if (distance < bestDistance) { bestDistance = distance; best = layer; }
  }
  return best;
}

export function isOnDeck(position: Vec3, margin = 0) {
  return deckDistance(position) <= DECK_CATCH_RADIUS + margin;
}

export function stationRadial(station: StationDefinition): Vec3 {
  return { x: Math.sin(station.angle), y: 0, z: Math.cos(station.angle) };
}

export function stationTangent(station: StationDefinition): Vec3 {
  return { x: Math.cos(station.angle), y: 0, z: -Math.sin(station.angle) };
}

export function stationPosition(station: StationDefinition): Vec3 {
  const radial = stationRadial(station);
  return { x: radial.x * station.radius, y: 0, z: radial.z * station.radius };
}

export function stationRotation(station: StationDefinition) {
  return station.facing ?? station.angle + Math.PI;
}

export { TUNNEL_HALF };

export function rackSlotPosition(station: StationDefinition, slot: number): Vec3 {
  const base = stationPosition(station);
  const radial = stationRadial(station);
  return {
    x: base.x - radial.x * RACK_STACK_FORWARD,
    y: RACK_STACK_Y - slot * RACK_STACK_STEP,
    z: base.z - radial.z * RACK_STACK_FORWARD,
  };
}

export function stationEntry(station: StationDefinition): Vec3 {
  const base = stationPosition(station);
  if (station.kind !== 'echo') return base;
  const tangent = stationTangent(station);
  const flank = stationFlank(station);
  return { x: base.x - tangent.x * flank * TUNNEL_HALF, y: 0, z: base.z - tangent.z * flank * TUNNEL_HALF };
}

export function stationFlank(station: StationDefinition): 1 | -1 {
  return station.angle > Math.PI ? 1 : -1;
}

export function stationExit(station: StationDefinition): Vec3 {
  const base = stationPosition(station);
  if (station.facing !== undefined) {
    return { x: base.x + Math.sin(station.facing) * 1.35,
      y: STATION_RELEASE_Y[station.kind], z: base.z + Math.cos(station.facing) * 1.35 };
  }
  const tangent = stationTangent(station);
  const flank = stationFlank(station);
  if (station.kind === 'echo') {
    return { x: base.x + tangent.x * flank * TUNNEL_HALF, y: STATION_RELEASE_Y.echo, z: base.z + tangent.z * flank * TUNNEL_HALF };
  }
  const radial = stationRadial(station);
  const side = STATION_BODY_RADIUS[station.kind] * 0.7;
  return {
    x: base.x + tangent.x * flank * side - radial.x * 1,
    y: STATION_RELEASE_Y[station.kind],
    z: base.z + tangent.z * flank * side - radial.z * 1,
  };
}

export function stationEjectDirection(station: StationDefinition): Vec3 {
  const tangent = stationTangent(station);
  const radial = stationRadial(station);
  const flank = stationFlank(station);
  return normalizeXZ({
    x: tangent.x * flank * (1 - EJECT_INWARD) - radial.x * EJECT_INWARD,
    y: 0,
    z: tangent.z * flank * (1 - EJECT_INWARD) - radial.z * EJECT_INWARD,
  });
}

export function stationNearestPoint(station: StationDefinition, position: Vec3): Vec3 {
  const base = stationPosition(station);
  const half = STATION_BODY_HALF[station.kind];
  if (half <= 0) return base;
  const tangent = stationTangent(station);
  const along = clamp(
    (position.x - base.x) * tangent.x + (position.z - base.z) * tangent.z,
    -half,
    half,
  );
  return { x: base.x + tangent.x * along, y: 0, z: base.z + tangent.z * along };
}

export function resolveStationCollision<T extends Vec3>(position: T, bodyRadius = 0.58): T {
  for (const station of STATIONS) {
    const radius = STATION_BODY_RADIUS[station.kind];
    if (radius <= 0) continue;
    const anchor = stationNearestPoint(station, position);
    const distance = distanceXZ(position, anchor);
    const minimum = radius + bodyRadius;
    if (distance >= minimum) continue;
    if (distance < 1e-4) {
      const radial = stationRadial(station);
      position.x = anchor.x - radial.x * minimum;
      position.z = anchor.z - radial.z * minimum;
      continue;
    }
    const k = (minimum - distance) / distance;
    position.x += (position.x - anchor.x) * k;
    position.z += (position.z - anchor.z) * k;
  }
  return position;
}

export function nearestStation(
  position: Vec3,
  reach: number,
): { station: StationDefinition; distance: number } | null {
  let best: { station: StationDefinition; distance: number } | null = null;
  for (const station of STATIONS) {
    const anchor = station.kind === 'echo'
      ? nearer(position, stationEntry(station), stationPosition(station))
      : stationNearestPoint(station, position);
    const distance = distanceXZ(position, anchor);
    if (distance <= reach && (!best || distance < best.distance)) best = { station, distance };
  }
  return best;
}

export function machineUnder(position: Vec3): StationDefinition | null {
  if (position.y > MACHINE_CATCH_Y) return null;
  for (const station of STATIONS) {
    if (station.kind === 'rack') continue;
    const anchor = stationNearestPoint(station, position);
    if (distanceXZ(position, anchor) <= STATION_BODY_RADIUS[station.kind] + MACHINE_CATCH_MARGIN) return station;
  }
  return null;
}

function nearer(from: Vec3, a: Vec3, b: Vec3) {
  return distanceXZ(from, a) <= distanceXZ(from, b) ? a : b;
}

export function lobLaunch(heading: Vec3, power: number): Vec3 {
  const flat = normalizeXZ(heading);
  const elevation = (LOB_ELEVATION_DEG / 180) * Math.PI;
  const across = Math.cos(elevation) * power;
  return { x: flat.x * across, y: Math.sin(elevation) * power, z: flat.z * across };
}

export type LobPlot = {
  launch: Vec3;
  airtime: number;
  arc: Vec3[];
  landing: Vec3;
};

export function plotLob(from: Vec3, heading: Vec3, power: number, samples = 18): LobPlot {
  const launch = lobLaunch(heading, power);
  const fall = Math.max(0, from.y - BLOCK_REST_Y);
  const airtime = (launch.y + Math.sqrt(Math.max(0, launch.y ** 2 + 2 * FALL_ACCEL * fall))) / FALL_ACCEL;
  const steps = Math.max(1, samples - 1);
  const arc = Array.from({ length: samples }, (_, i) => {
    const t = (airtime * i) / steps;
    return {
      x: from.x + launch.x * t,
      y: Math.max(BLOCK_REST_Y, from.y + (launch.y - (FALL_ACCEL * t) / 2) * t),
      z: from.z + launch.z * t,
    };
  });
  return { launch, airtime, arc, landing: arc[arc.length - 1]! };
}
