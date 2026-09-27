import { loudnessPercentile, predictMix, themeMixStats, type MixLayer, type MixReading } from './mix.js';
import { homeClusters } from './stock.js';
import { LOOP_LAYERS, sample, type LoopLayer } from './themes.js';
import { FX_IDS } from './types.js';
import type { FxId } from './types.js';
import type { SectionGoal } from './song.js';

export type EvaluationKey = 'shape' | 'development' | 'arc' | 'mix' | 'coherence' | 'treatment' | 'momentum';

export type EvaluationLine = {
  key: EvaluationKey;
  label: string;
  points: number;
  max: number;
  note: string;
};

export type SectionEvaluation = {
  total: number;
  lines: EvaluationLine[];
  mix: MixReading;
};

export type EvaluationInput = {
  themeId: string;
  runSeed: number;
  goal: SectionGoal;
  sectionIndex: number;
  layers: Record<LoopLayer, MixLayer>;
  baseline: Record<LoopLayer, MixLayer>;
  history: Array<{ name: string; mix: MixReading }>;
  reading: MixReading | null;
  coordinated: number;
  printedAt: number;
  transportStartedAt: number;
  showEndsAt: number;
  sectionCount: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number) => Math.round(value);
const signed = (value: number, digits = 1) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;

function windowScore(value: number, [low, high]: [number, number], fade: number) {
  if (value >= low && value <= high) return 1;
  const miss = value < low ? low - value : value - high;
  return clamp01(1 - miss / fade);
}

export function evaluateSection(input: EvaluationInput): SectionEvaluation {
  const predicted = predictMix(input.themeId, input.layers);
  const mix: MixReading = input.reading ?? predicted;
  const previous = input.history[input.history.length - 1]?.mix ?? null;
  const lines = [
    shape(input, predicted.layers, mix),
    development(input),
    arc(input, mix, previous),
    mixHealth(input, mix, predicted),
    coherence(input),
    treatment(input),
    momentum(input),
  ];
  return { total: lines.reduce((sum, line) => sum + line.points, 0), lines, mix };
}

function shape(input: EvaluationInput, layers: number, mix: MixReading): EvaluationLine {
  const { goal } = input;
  const under = goal.minLayers !== undefined ? Math.max(0, goal.minLayers - layers) : 0;
  const over = goal.maxLayers !== undefined ? Math.max(0, layers - goal.maxLayers) : 0;
  const count = Math.max(0, 1 - (under + over) * 0.45);
  const place = loudnessPercentile(input.themeId, mix.loudnessDb);
  const weight = windowScore(place, goal.intensity, 0.3);
  const points = round(count * 100 + weight * 100);

  const size = `${layers} layer${layers === 1 ? '' : 's'}`;
  let note: string;
  if (under > 0) note = `${size} — a ${goal.name.toLowerCase()} wants ${goal.minLayers}+`;
  else if (over > 0) note = `${size} — a ${goal.name.toLowerCase()} wants ${goal.maxLayers} at most`;
  else if (weight < 0.99) note = place < goal.intensity[0] ? `${size}, but light for a ${goal.name.toLowerCase()}` : `${size}, but heavy for a ${goal.name.toLowerCase()}`;
  else note = `${size}, ${describeWeight(place)}`;
  return { key: 'shape', label: 'SHAPE', points, max: 200, note };
}

function describeWeight(place: number) {
  if (place < 0.25) return 'sitting low and sparse';
  if (place < 0.5) return 'at a comfortable middle weight';
  if (place < 0.75) return 'full and driving';
  return 'at full weight';
}

function development(input: EvaluationInput): EvaluationLine {
  let moved = 0;
  const changes: string[] = [];
  for (const layer of LOOP_LAYERS) {
    const before = input.baseline[layer];
    const now = input.layers[layer];
    if (before.sampleName !== now.sampleName) {
      if (!now.sampleName) { moved += 0.8; changes.push(`dropped the ${layer.toLowerCase()}`); }
      else if (!before.sampleName) { moved += 1; changes.push(`brought in ${layer.toLowerCase()}`); }
      else { moved += 1; changes.push(`new ${layer.toLowerCase()}`); }
    } else if (now.sampleName && fxKey(before) !== fxKey(now)) {
      moved += 0.6;
      changes.push(fxChange(layer, before, now));
    }
  }
  const points = round(clamp01(moved / 2) * 180);
  const note = changes.length === 0
    ? `Same mix as ${input.sectionIndex === 0 ? 'the opening' : 'the last section'} — nothing developed`
    : capitalise(changes.slice(0, 3).join(', '));
  return { key: 'development', label: 'DEVELOPMENT', points, max: 180, note };
}

const fxKey = (layer: MixLayer) => FX_IDS.filter((id) => layer.fx[id]).join('+');

function unchanged(input: EvaluationInput) {
  return LOOP_LAYERS.every((layer) => input.baseline[layer].sampleName === input.layers[layer].sampleName
    && fxKey(input.baseline[layer]) === fxKey(input.layers[layer]));
}

const FX_VERBS: Record<FxId, string> = {
  filter: 'shaded',
  crush: 'crunched',
  reverb: 'echoed',
  space: 'opened up',
  wide: 'widened',
  swirl: 'swirled',
  warp: 'warped',
};

function fxChange(layer: LoopLayer, before: MixLayer, now: MixLayer) {
  const name = layer.toLowerCase();
  const stripped = FX_IDS.filter((id) => before.fx[id] && !now.fx[id]);
  const added = FX_IDS.find((id) => !before.fx[id] && now.fx[id]);
  if (stripped.length > 0 && !added) {
    return stripped.length === 1
      ? `took ${FX_NAMES[stripped[0]!]} off the ${name}`
      : `washed the ${name} back to bare`;
  }
  if (added) return `${FX_VERBS[added]} the ${name}`;
  return `re-treated the ${name}`;
}

function arc(input: EvaluationInput, mix: MixReading, previous: MixReading | null): EvaluationLine {
  const { goal } = input;
  if (previous && unchanged(input)) {
    return { key: 'arc', label: 'ARC', points: 0, max: 180, note: `Identical to the ${input.history[input.history.length - 1]!.name.toLowerCase()} — no step at all` };
  }
  if (!goal.lift || !previous) {
    const place = loudnessPercentile(input.themeId, mix.loudnessDb);
    const room = windowScore(place, [0, 0.45], 0.35);
    return {
      key: 'arc', label: 'ARC', points: round(room * 180), max: 180,
      note: room > 0.99 ? 'Leaves the track room to build' : 'Starts loud — little left to build to',
    };
  }
  const step = mix.loudnessDb - previous.loudnessDb;
  const bright = goal.brightLift ? ((mix.shares[2] + mix.shares[3]) - (previous.shares[2] + previous.shares[3])) * 25 : 0;
  const lift = step + Math.max(0, bright);
  let score = windowScore(lift, goal.lift, 2);
  let note = `${signed(step)} dB from the ${input.history[input.history.length - 1]!.name.toLowerCase()}`;
  if (goal.peak) {
    const loudest = Math.max(...input.history.map((entry) => entry.mix.loudnessDb));
    const short = loudest - mix.loudnessDb;
    if (short > 0.5) {
      score *= clamp01(1 - (short - 0.5) / 3);
      note += ` — but ${short.toFixed(1)} dB under the track's loudest`;
    } else {
      note += ' — the peak of the track';
    }
  } else if (score > 0.99) {
    note += goal.lift[1] <= 0 ? ' — brought it home' : bright > 0.4 && step < goal.lift[0] ? ' — lifted by getting brighter' : ' — a real step';
  } else if (lift < goal.lift[0]) {
    note += goal.lift[1] <= 0 ? ' — wants to come down further' : ' — wants more lift';
  } else {
    note += ' — too big a jump';
  }
  return { key: 'arc', label: 'ARC', points: round(score * 180), max: 180, note };
}

function mixHealth(input: EvaluationInput, mix: MixReading, predicted: ReturnType<typeof predictMix>): EvaluationLine {
  const stats = themeMixStats(input.themeId);
  const problems: Array<[number, string]> = [];

  const [ok, bad] = mix.source === 'measured' ? [0.6, 4] : [3, 8];
  const headroom = clamp01(1 - (mix.limitingDb - ok) / (bad - ok));
  if (headroom < 0.9) problems.push([1 - headroom, `master pushing the limiter (${mix.limitingDb.toFixed(1)} dB)`]);

  const low = mix.shares[0];
  const lowRange: [number, number] = [stats?.lowShare.p05 ?? 0.15, stats?.lowShare.p95 ?? 0.85];
  const lowScore = predicted.layers >= 2 ? windowScore(low, lowRange, 0.15) : 1;
  if (lowScore < 0.9) problems.push([1 - lowScore, low > lowRange[1] ? `low end crowding (${Math.round(low * 100)}% below 160 Hz)` : 'thin at the bottom']);

  const high = mix.shares[3];
  const highMax = (stats?.highShare.p95 ?? 0.1) + 0.02;
  const highScore = clamp01(1 - Math.max(0, high - highMax) / 0.08);
  if (highScore < 0.9) problems.push([1 - highScore, 'harsh at the top']);

  const dominanceMax = stats?.dominance.p75 ?? 0.7;
  const balance = predicted.layers >= 3 ? clamp01(1 - Math.max(0, predicted.dominance - dominanceMax) / 0.25) : 1;
  if (balance < 0.9 && predicted.loudest) problems.push([1 - balance, `the ${predicted.loudest.toLowerCase()} is burying the rest`]);

  const points = round(headroom * 60 + lowScore * 50 + highScore * 30 + balance * 40);
  const worst = problems.sort((a, b) => b[0] - a[0])[0];
  const source = mix.source === 'measured' ? 'measured' : 'estimated';
  const note = worst ? `${capitalise(worst[1])} (${source})` : `Clean — headroom, balance and a clear low end (${source})`;
  return { key: 'mix', label: 'MIX', points, max: 180, note };
}

function coherence(input: EvaluationInput): EvaluationLine {
  const entries = LOOP_LAYERS.map((layer) => sample(input.layers[layer].sampleName, input.themeId)).filter((entry) => !!entry);
  if (entries.length <= 1) return { key: 'coherence', label: 'COHERENCE', points: 0, max: 100, note: 'One record — nothing to hold together yet' };
  const counts = new Map<string, { label: string; count: number }>();
  for (const entry of entries) {
    const current = counts.get(entry!.pack) ?? { label: entry!.packLabel, count: 0 };
    current.count += 1;
    counts.set(entry!.pack, current);
  }
  const [, lead] = [...counts.entries()].sort((a, b) => b[1].count - a[1].count)[0]!;
  const home = new Set(homeClusters(input.themeId, input.runSeed));
  const inHome = entries.filter((entry) => home.has(entry!.cluster)).length;
  const cohesion = 0.65 * ((lead.count - 1) / (entries.length - 1)) + 0.35 * (inHome / entries.length);
  const points = round(clamp01(cohesion / 0.8) * 100);
  const note = lead.count >= 2
    ? `${lead.count} of ${entries.length} from ${shortPack(lead.label)}`
    : `${entries.length} records from ${counts.size} different packs`;
  return { key: 'coherence', label: 'COHERENCE', points, max: 100, note };
}

function shortPack(label: string) {
  return label.length > 28 ? `${label.slice(0, 26).trim()}…` : label;
}

const SUITS: Record<FxId, { sections: Record<string, number>; roles: Record<LoopLayer, number> }> = {
  filter: {
    sections: { INTRO: 1, GROOVE: 0.5, BUILD: 1, DROP: 0.25, OUTRO: 1 },
    roles: { DRUMS: 1, BASS: 0.8, MUSIC: 1, TOPS: 1 },
  },
  reverb: {
    sections: { INTRO: 1, GROOVE: 0.6, BUILD: 1, DROP: 0.5, OUTRO: 1 },
    roles: { DRUMS: 0.5, BASS: 0.3, MUSIC: 1, TOPS: 1 },
  },
  crush: {
    sections: { INTRO: 0.3, GROOVE: 0.6, BUILD: 1, DROP: 1, OUTRO: 0.3 },
    roles: { DRUMS: 1, BASS: 1, MUSIC: 0.7, TOPS: 0.6 },
  },
  space: {
    sections: { INTRO: 1, GROOVE: 0.5, BUILD: 0.9, DROP: 0.3, OUTRO: 1 },
    roles: { DRUMS: 0.4, BASS: 0.2, MUSIC: 1, TOPS: 1 },
  },
  wide: {
    sections: { INTRO: 0.7, GROOVE: 1, BUILD: 0.8, DROP: 1, OUTRO: 0.7 },
    roles: { DRUMS: 0.5, BASS: 0.15, MUSIC: 1, TOPS: 1 },
  },
  swirl: {
    sections: { INTRO: 0.5, GROOVE: 1, BUILD: 1, DROP: 0.5, OUTRO: 0.6 },
    roles: { DRUMS: 0.6, BASS: 0.5, MUSIC: 1, TOPS: 0.9 },
  },
  warp: {
    sections: { INTRO: 0.5, GROOVE: 0.6, BUILD: 1, DROP: 0.3, OUTRO: 0.8 },
    roles: { DRUMS: 0.5, BASS: 0.2, MUSIC: 0.9, TOPS: 1 },
  },
};

const FX_NAMES: Record<FxId, string> = {
  filter: 'SHADE', reverb: 'ECHO', crush: 'CRUNCH',
  space: 'SPACE', wide: 'WIDE', swirl: 'SWIRL', warp: 'WARP',
};

function treatment(input: EvaluationInput): EvaluationLine {
  let value = 0;
  let best: [number, string] | null = null;
  let treated = 0;
  for (const layer of LOOP_LAYERS) {
    const entry = input.layers[layer];
    if (!entry.sampleName) continue;
    for (const fx of FX_IDS) {
      if (!entry.fx[fx]) continue;
      treated += 1;
      const suit = (SUITS[fx].sections[input.goal.name] ?? 0.5) * SUITS[fx].roles[layer];
      value += suit;
      if (!best || suit > best[0]) best = [suit, `${FX_NAMES[fx]} on the ${layer.toLowerCase()}`];
    }
  }
  const points = round(clamp01(value / 1.4) * 80);
  let note: string;
  if (treated === 0) note = 'Nothing treated — a machine could have earned 80';
  else if (best && best[0] >= 0.8) note = `${capitalise(best[1])} suits a ${input.goal.name.toLowerCase()}`;
  else note = `${capitalise(best![1])} — an odd fit for a ${input.goal.name.toLowerCase()}`;
  return { key: 'treatment', label: 'TREATMENT', points, max: 80, note };
}

export const PACE_GRACE_MS = 8_000;
export const PACE_FADE_MS = 36_000;

export function paceLine(sectionIndex: number, sectionCount: number, transportStartedAt: number, showEndsAt: number) {
  return transportStartedAt + ((sectionIndex + 1) / sectionCount) * (showEndsAt - transportStartedAt);
}

function momentum(input: EvaluationInput): EvaluationLine {
  const due = paceLine(input.sectionIndex, input.sectionCount, input.transportStartedAt, input.showEndsAt);
  const late = input.printedAt - due;
  const overtime = input.printedAt >= input.showEndsAt;
  const progress = unchanged(input) ? 0.25 : 1;
  const pace = overtime ? 0 : clamp01(1 - Math.max(0, late - PACE_GRACE_MS) / PACE_FADE_MS) * progress;
  const together = Math.min(1, input.coordinated);
  const points = round(pace * 60 + together * 20);
  let note = overtime
    ? 'Printed in overtime'
    : late <= 0 ? `${Math.round(-late / 1000)} s ahead of pace` : `${Math.round(late / 1000)} s behind pace`;
  if (input.coordinated > 0) note += ` · ${input.coordinated} drop${input.coordinated === 1 ? '' : 's'} landed together`;
  return { key: 'momentum', label: 'MOMENTUM', points, max: 80, note };
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
