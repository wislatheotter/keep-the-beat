import { DECK_COLLISION_RADIUS, DECK_POSITION } from '@loop/shared';

export type FloorPoint = { x: number; z: number };

const MARGIN = 0.75;
const ARC_STEP = 0.3;

const TAU = Math.PI * 2;

export function routeAroundDeck(from: FloorPoint, to: FloorPoint, out: FloorPoint[], margin = MARGIN): number {
  const cx = DECK_POSITION.x;
  const cz = DECK_POSITION.z;
  const fromDistance = Math.hypot(from.x - cx, from.z - cz);
  const toDistance = Math.hypot(to.x - cx, to.z - cz);
  const radius = Math.max(DECK_COLLISION_RADIUS, Math.min(DECK_COLLISION_RADIUS + margin, fromDistance - 1e-3, toDistance - 1e-3));

  let count = 0;
  const push = (x: number, z: number) => {
    const point = out[count] ?? (out[count] = { x: 0, z: 0 });
    point.x = x;
    point.z = z;
    count += 1;
  };

  push(from.x, from.z);
  if (!crosses(from, to, cx, cz, radius)) {
    push(to.x, to.z);
    return count;
  }

  const fromAngle = Math.atan2(from.z - cz, from.x - cx);
  const toAngle = Math.atan2(to.z - cz, to.x - cx);
  const fromSpread = Math.acos(Math.min(1, radius / Math.max(radius, fromDistance)));
  const toSpread = Math.acos(Math.min(1, radius / Math.max(radius, toDistance)));

  let best = { side: 1, start: 0, sweep: 0, length: Infinity };
  for (const side of [1, -1]) {
    const start = fromAngle + side * fromSpread;
    const end = toAngle - side * toSpread;
    const sweep = modulo((end - start) * side, TAU);
    const leave = Math.hypot(from.x - (cx + Math.cos(start) * radius), from.z - (cz + Math.sin(start) * radius));
    const arrive = Math.hypot(to.x - (cx + Math.cos(end) * radius), to.z - (cz + Math.sin(end) * radius));
    const length = leave + sweep * radius + arrive;
    if (length < best.length) best = { side, start, sweep, length };
  }

  const steps = Math.max(1, Math.ceil(best.sweep / ARC_STEP));
  for (let i = 0; i <= steps; i += 1) {
    const angle = best.start + best.side * best.sweep * (i / steps);
    push(cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius);
  }
  push(to.x, to.z);
  return count;
}

export function routeLength(points: FloorPoint[], count: number): number {
  let length = 0;
  for (let i = 1; i < count; i += 1) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  return length;
}

export function alongRoute(
  points: FloorPoint[],
  count: number,
  distance: number,
  out: { x: number; z: number; heading: number },
) {
  let left = Math.max(0, distance);
  for (let i = 1; i < count; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    if (span <= 1e-6) continue;
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (left <= span || i === count - 1) {
      const t = Math.min(1, left / span);
      out.x = a.x + (b.x - a.x) * t;
      out.z = a.z + (b.z - a.z) * t;
      out.heading = heading;
      return out;
    }
    left -= span;
  }
  const last = points[Math.max(0, count - 1)]!;
  out.x = last.x;
  out.z = last.z;
  return out;
}

function crosses(a: FloorPoint, b: FloorPoint, cx: number, cz: number, radius: number) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const span = dx * dx + dz * dz;
  const t = span > 0 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cz - a.z) * dz) / span)) : 0;
  return Math.hypot(a.x + dx * t - cx, a.z + dz * t - cz) < radius - 1e-3;
}

function modulo(value: number, by: number) {
  return ((value % by) + by) % by;
}
