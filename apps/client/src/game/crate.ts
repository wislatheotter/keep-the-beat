import { RACKS, RACK_SLOTS, clamp, type BlockState, type StationState } from '@loop/shared';

export const STATION_SCALE = 1.25;

export const PEDESTAL_TOP = 0.92;
export const PILE_STEP = 0.055;
export const CRATE_TILT = 0.3;

const RECORD_REACH_OUT = 0.72 * 1.05 * 1.05;
const RECORD_HALF_THICK = (0.17 * 1.35) / 2;
const REST_GAP = RECORD_REACH_OUT * Math.sin(CRATE_TILT) + RECORD_HALF_THICK * Math.cos(CRATE_TILT) + 0.05;

export function pileCount(crateSize: number) {
  return crateSize >= RACK_SLOTS ? 4 : crateSize === 2 ? 2 : 0;
}

export function crateRestY(crateSize: number) {
  return (PEDESTAL_TOP + pileCount(crateSize) * PILE_STEP + REST_GAP) * STATION_SCALE;
}

export const RESTOCK_MS = 900;
export const FEED_DELAY_MS = 120;
export const FEED_MS = 540;

const RACK_ORDER = Object.fromEntries(RACKS.map((rack, index) => [rack.id, index]));

export function restockProgress(station: StationState, now: number) {
  return clamp((now - station.restockedAt) / RESTOCK_MS, 0, 1);
}

export function riseProgress(block: BlockState, station: StationState | undefined, now: number) {
  const batch = !station || block.dealtAt <= station.restockedAt + 50;
  const delay = batch ? 380 + (RACK_ORDER[block.rackId ?? ''] ?? 0) * 90 : FEED_DELAY_MS;
  const elapsed = now - block.dealtAt - delay;
  if (elapsed < 0) return -1;
  return clamp(elapsed / FEED_MS, 0, 1);
}

export function pileArrival(station: StationState, disc: number, now: number) {
  const delay = (RACK_ORDER[station.id] ?? 0) * 90 + disc * 55;
  return clamp((now - station.restockedAt - delay) / 320, 0, 1);
}
