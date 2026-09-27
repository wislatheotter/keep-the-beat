import {
  FX_IDS,
  sectionAtBar,
  type FxSet,
  type GameState,
  type LoopLayer,
  type ReplayClock,
} from '@loop/shared';

export type Disc = { sampleName: string; fx: FxSet };

export type PlatterMoment = {
  current: Disc | null;
  incoming: Disc | null;
  arriving: number;
  outgoing: Disc | null;
  leaving: number;
  landing: number;
};

export const ARRIVE_BARS = 0.5;
export const LEAVE_BARS = 0.6;
const LAND_BARS = 0.5;

export const discKey = (disc: Disc | null) =>
  disc ? `${disc.sampleName}|${FX_IDS.map((fx) => +disc.fx[fx]).join('')}` : '';

const same = (a: Disc | null, b: Disc | null) => discKey(a) === discKey(b);

function asDisc(entry: { sampleName: string | null; fx: FxSet } | undefined | null): Disc | null {
  return entry?.sampleName ? { sampleName: entry.sampleName, fx: entry.fx } : null;
}

function discAt(state: GameState, clock: ReplayClock, layer: LoopLayer, bar: number, pass: number): Disc | null {
  if (bar < 0) return pass === 0 ? asDisc(state.song.layers[layer]) : null;
  if (bar >= clock.cycleBars) return discAt(state, clock, layer, bar - clock.cycleBars, pass + 1);
  const index = sectionAtBar(state.song.committed, bar);
  return index >= 0 ? asDisc(state.song.committed[index]!.layers[layer]) : null;
}

function boundaries(state: GameState, clock: ReplayClock): number[] {
  const bars = state.song.committed.map((section) => section.startBar);
  bars.push(clock.songBars, clock.cycleBars);
  if (!bars.includes(0)) bars.unshift(0);
  return bars;
}

export function platterMoment(state: GameState, clock: ReplayClock, layer: LoopLayer): PlatterMoment {
  const { bar, pass } = clock;
  const current = discAt(state, clock, layer, bar, pass);
  const moment: PlatterMoment = { current, incoming: null, arriving: 0, outgoing: null, leaving: 0, landing: 0 };
  if (clock.songBars === 0) return moment;

  const marks = boundaries(state, clock);
  const next = marks.find((mark) => mark > bar);
  if (next !== undefined && next - bar < ARRIVE_BARS) {
    const coming = discAt(state, clock, layer, next, pass);
    if (coming && !same(coming, current)) {
      moment.incoming = coming;
      moment.arriving = 1 - (next - bar) / ARRIVE_BARS;
    }
  }
  let last: number | undefined;
  for (const mark of marks) if (mark <= bar) last = mark;
  if (last !== undefined) {
    const since = bar - last;
    const before = discAt(state, clock, layer, last - 1e-4, pass);
    if (!same(before, current)) {
      if (before && since < LEAVE_BARS) {
        moment.outgoing = before;
        moment.leaving = since / LEAVE_BARS;
      }
      if (current && since < LAND_BARS) moment.landing = 1 - since / LAND_BARS;
    }
  }
  return moment;
}
