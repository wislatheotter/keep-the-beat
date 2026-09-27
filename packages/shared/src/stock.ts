import { LOOP_LAYERS, samplesFor, theme, type GameSample, type LoopLayer, type SampleRole, type ThemeId } from './themes.js';
import { keyLabel, shiftFor } from './transform.js';
import { RACK_SLOTS } from './constants.js';

export function hashString(text: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function noise(seed: number, ...parts: Array<string | number>): number {
  let h = hashString(String(seed));
  for (const part of parts) h = hashString(String(part), h);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export const makeRunSeed = () => Math.floor(Math.random() * 0x7fffffff);

export type SectionProfile = { energy: number; busy: number };

export const SECTION_PROFILES: SectionProfile[] = [
  { energy: 0.14, busy: 0.12 },
  { energy: 0.48, busy: 0.46 },
  { energy: 0.70, busy: 0.68 },
  { energy: 0.94, busy: 0.90 },
  { energy: 0.20, busy: 0.22 },
];

export const profileFor = (sectionIndex: number): SectionProfile =>
  SECTION_PROFILES[Math.min(sectionIndex, SECTION_PROFILES.length - 1)]!;

function quantile(sorted: readonly number[], q: number) {
  if (sorted.length === 0) return 0;
  const at = q * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.min(sorted.length - 1, low + 1);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low);
}

export function sectionTarget(pool: readonly GameSample[], profile: SectionProfile) {
  const energies = pool.map((entry) => entry.energy).sort((a, b) => a - b);
  const busies = pool.map((entry) => entry.busy).sort((a, b) => a - b);
  return { energy: quantile(energies, profile.energy), busy: quantile(busies, profile.busy) };
}

function fit(
  sample: GameSample,
  target: { energy: number; busy: number },
  spread: { energy: number; busy: number },
) {
  const energyMiss = Math.abs(sample.energy - target.energy) / Math.max(0.06, spread.energy);
  const busyMiss = Math.abs(sample.busy - target.busy) / Math.max(0.06, spread.busy);
  return Math.max(0, 1 - (energyMiss * 0.6 + busyMiss * 0.4) * 0.55);
}

export type RunPlan = {
  sig: number | null;
  home: string[];
  crate: Record<LoopLayer, GameSample[]>;
};

const CRATE_SIZE: Record<LoopLayer, number> = { DRUMS: 16, BASS: 14, MUSIC: 16, TOPS: 14 };
const CRATE_MIN = 6;
const HOME_CLUSTER_COUNT = 2;
const AWAY_PENALTY = 1;

export type ClusterSummary = { cluster: string; count: number; roles: number };

export function themeClusters(themeId: ThemeId): ClusterSummary[] {
  const byCluster = new Map<string, { count: number; roles: Set<string> }>();
  for (const layer of LOOP_LAYERS) {
    for (const sample of samplesFor(themeId, layer)) {
      let entry = byCluster.get(sample.cluster);
      if (!entry) {
        entry = { count: 0, roles: new Set() };
        byCluster.set(sample.cluster, entry);
      }
      entry.count += 1;
      entry.roles.add(sample.role);
    }
  }
  return [...byCluster.entries()]
    .map(([cluster, entry]) => ({ cluster, count: entry.count, roles: entry.roles.size }))
    .sort((a, b) => b.roles - a.roles || b.count - a.count || a.cluster.localeCompare(b.cluster));
}

export function homeClusters(themeId: ThemeId, seed: number): string[] {
  return runPlan(themeId, seed).home;
}

function drawHome(themeId: ThemeId, seed: number): string[] {
  const candidates = themeClusters(themeId).filter((entry) => entry.count >= 3);
  if (candidates.length <= HOME_CLUSTER_COUNT) return candidates.map((entry) => entry.cluster);
  const remaining = [...candidates];
  const chosen: string[] = [];
  for (let pick = 0; pick < HOME_CLUSTER_COUNT && remaining.length > 0; pick += 1) {
    const weights = remaining.map((entry) => (entry.roles + 1) * Math.sqrt(entry.count));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let target = noise(seed, 'home', pick) * total;
    let index = 0;
    while (index < weights.length - 1 && target > weights[index]!) {
      target -= weights[index]!;
      index += 1;
    }
    chosen.push(remaining[index]!.cluster);
    remaining.splice(index, 1);
  }
  return chosen;
}

function keyScore(records: readonly GameSample[], sig: number) {
  let score = 0;
  const reached: Record<string, number> = { DRUMS: 0, BASS: 0, MUSIC: 0, TOPS: 0 };
  for (const sample of records) {
    if (sample.keySig === null) continue;
    const shift = shiftFor(sample, sig);
    if (shift === null) continue;
    reached[sample.role] = (reached[sample.role] ?? 0) + 1;
    score += 1 / (1 + 0.35 * Math.abs(shift));
  }
  return score * Math.min(1, (Math.min(reached.BASS!, reached.MUSIC!) + 1) / 6);
}

function drawKey(themeId: ThemeId, seed: number, home: readonly string[]): number | null {
  const kit = theme(themeId);
  const all = LOOP_LAYERS.flatMap((layer) => samplesFor(themeId, layer));
  if (!all.some((sample) => sample.keySig !== null)) return null;
  const local = all.filter((sample) => home.includes(sample.cluster));
  const allowed = kit.keys?.length ? kit.keys.map((entry) => entry.sig) : [...Array(12).keys()];
  const scored = allowed
    .map((sig) => ({ sig, score: keyScore(local, sig) + 0.25 * keyScore(all, sig) }))
    .sort((a, b) => b.score - a.score || a.sig - b.sig);
  const best = scored[0]!.score;
  const shortlist = scored.filter((entry) => entry.score >= best * 0.8).slice(0, 4);
  return shortlist[Math.floor(noise(seed, 'key') * shortlist.length) % shortlist.length]!.sig;
}

const plans = new Map<string, RunPlan>();
export function runPlan(themeId: ThemeId, seed: number): RunPlan {
  const key = `${themeId}|${seed}`;
  const cached = plans.get(key);
  if (cached) return cached;
  const home = drawHome(themeId, seed);
  const sig = drawKey(themeId, seed, home);
  const kit = theme(themeId);
  const crate = Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, [] as GameSample[]])) as Record<LoopLayer, GameSample[]>;
  const index = new Map(kit.samples.map((sample, i) => [sample, i]));
  const inCrate = new Set<number>();
  const order = LOOP_LAYERS.flatMap((layer) => samplesFor(themeId, layer))
    .filter((sample) => shiftFor(sample, sig) !== null)
    .map((sample) => ({
      sample,
      rank: (home.includes(sample.cluster) ? 0 : AWAY_PENALTY) + noise(seed, 'crate', sample.sampleName),
    }))
    .sort((a, b) => a.rank - b.rank || a.sample.sampleName.localeCompare(b.sample.sampleName));
  const queues = LOOP_LAYERS.map((layer) => ({ layer, queue: order.filter((entry) => entry.sample.role === layer) }))
    .sort((a, b) => a.queue.length - b.queue.length);
  const clashesWithCrate = (sample: GameSample) => sample.clash.some((other) => inCrate.has(other));
  const reach = (layer: LoopLayer, queue: typeof order) =>
    crate[layer].length + queue.filter((entry) => !clashesWithCrate(entry.sample)).length;
  const starves = (sample: GameSample, own: number) => queues.some(({ layer, queue }) => {
    if (layer === sample.role) return false;
    const left = reach(layer, queue);
    if (left > CRATE_MIN || left >= own) return false;
    const mine = new Set(sample.clash);
    return queue.some((entry) => !clashesWithCrate(entry.sample) && mine.has(index.get(entry.sample)!));
  });
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const { layer, queue } of queues) {
      while (queue.length > 0 && crate[layer].length < CRATE_SIZE[layer]) {
        const own = reach(layer, queue);
        const { sample } = queue.shift()!;
        if (clashesWithCrate(sample) || starves(sample, own)) continue;
        crate[layer].push(sample);
        inCrate.add(index.get(sample)!);
        progressed = true;
        break;
      }
    }
  }
  const plan: RunPlan = { sig, home, crate };
  if (plans.size > 64) plans.clear();
  plans.set(key, plan);
  return plan;
}

export function runKey(themeId: ThemeId, seed: number): number | null {
  return runPlan(themeId, seed).sig;
}

export function runKeyLabel(themeId: ThemeId, seed: number): string {
  const sig = runKey(themeId, seed);
  return sig === null ? 'any key' : keyLabel(sig);
}

export function runPool(themeId: ThemeId, seed: number, role: SampleRole): GameSample[] {
  if (role === 'SPECIAL') return samplesFor(themeId, role);
  return runPlan(themeId, seed).crate[role];
}

export function leadCluster(themeId: ThemeId, seed: number, sectionIndex: number): string | null {
  const home = homeClusters(themeId, seed);
  if (home.length === 0) return null;
  return home[Math.floor(noise(seed, 'lead', sectionIndex) * home.length) % home.length]!;
}

export type StockDeal = Record<LoopLayer, GameSample[]>;

const emptyDeal = (): StockDeal =>
  Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, [] as GameSample[]])) as StockDeal;

function rank(
  themeId: ThemeId,
  seed: number,
  sectionIndex: number,
  role: SampleRole,
  home: readonly string[],
  lead: string | null,
): GameSample[] {
  const pool = runPool(themeId, seed, role);
  const profile = profileFor(sectionIndex);
  const target = sectionTarget(pool, profile);
  const spread = {
    energy: spreadOf(pool.map((entry) => entry.energy)),
    busy: spreadOf(pool.map((entry) => entry.busy)),
  };
  const bySuit = [...pool]
    .map((sample) => {
      const homeBonus = sample.cluster === lead ? 0.62 : home.includes(sample.cluster) ? 0.4 : 0;
      return { sample, score: fit(sample, target, spread) + homeBonus };
    })
    .sort((a, b) => b.score - a.score || a.sample.sampleName.localeCompare(b.sample.sampleName))
    .map((entry) => entry.sample);

  const draw = (sample: GameSample) => noise(seed, 'draw', role, sample.sampleName);
  const shuffled = (list: GameSample[]) => list.sort((a, b) => draw(a) - draw(b));
  const band = suitedCount(bySuit.length);
  return [...shuffled(bySuit.slice(0, band)), ...shuffled(bySuit.slice(band))];
}

const FIT_SHARE = 0.25;

const suitedCount = (poolSize: number) => Math.min(poolSize, Math.max(RACK_SLOTS * 2, Math.ceil(poolSize * FIT_SHARE)));

function spreadOf(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.max(0, (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / 2);
}

const rankings = new Map<string, GameSample[]>();
export function rackRanking(themeId: ThemeId, seed: number, sectionIndex: number, role: SampleRole): GameSample[] {
  const key = `${themeId}|${seed}|${sectionIndex}|${role}`;
  let ranked = rankings.get(key);
  if (!ranked) {
    ranked = rank(themeId, seed, sectionIndex, role, homeClusters(themeId, seed), leadCluster(themeId, seed, sectionIndex));
    if (rankings.size > 96) rankings.clear();
    rankings.set(key, ranked);
  }
  return ranked;
}

export type DealOptions = {
  unavailable: ReadonlySet<string>;
  avoid?: ReadonlyArray<ReadonlySet<string>>;
  alongside?: readonly GameSample[];
  count: number;
};

const VARIETY_WINDOW = 3;

export function dealRack(
  themeId: ThemeId,
  seed: number,
  sectionIndex: number,
  role: SampleRole,
  options: DealOptions,
): GameSample[] {
  const ranked = rackRanking(themeId, seed, sectionIndex, role);
  const picked: GameSample[] = [];
  const families = new Set((options.alongside ?? []).map((entry) => entry.family));
  const avoid = options.avoid ?? [];

  const suited = ranked.slice(0, suitedCount(ranked.length));
  for (let relaxed = 0; relaxed <= avoid.length && picked.length < options.count; relaxed += 1) {
    const blocked = avoid.slice(0, avoid.length - relaxed);
    for (const scope of [suited, ranked]) {
      const eligible = scope.filter((entry) => !options.unavailable.has(entry.sampleName)
        && !picked.includes(entry)
        && !blocked.some((set) => set.has(entry.sampleName)));
      while (picked.length < options.count && eligible.length > 0) {
        const window = eligible.slice(0, VARIETY_WINDOW);
        const choice = window.find((entry) => !families.has(entry.family)) ?? window[0]!;
        picked.push(choice);
        families.add(choice.family);
        eligible.splice(eligible.indexOf(choice), 1);
      }
      if (picked.length >= options.count) break;
    }
  }
  return picked;
}

export function sectionDeal(
  themeId: ThemeId,
  seed: number,
  sectionIndex: number,
  unavailable: ReadonlySet<string>,
  avoid: ReadonlyArray<ReadonlySet<string>> = [],
  count = RACK_SLOTS,
): StockDeal {
  const deal = emptyDeal();
  for (const layer of LOOP_LAYERS) {
    deal[layer] = dealRack(themeId, seed, sectionIndex, layer, { unavailable, avoid, count });
  }
  return deal;
}

const planned = new Map<string, StockDeal>();
export function plannedStock(themeId: ThemeId, seed: number, sectionIndex: number): StockDeal {
  const key = `${themeId}|${seed}|${sectionIndex}`;
  const cached = planned.get(key);
  if (cached) return cached;
  const opening = new Set([openingRecord(themeId, seed)?.sampleName ?? '']);
  const avoid: Array<Set<string>> = [];
  for (const back of [1, 2]) {
    if (sectionIndex - back < 0) break;
    const earlier = plannedStock(themeId, seed, sectionIndex - back);
    avoid.push(new Set(LOOP_LAYERS.flatMap((layer) => earlier[layer].map((entry) => entry.sampleName))));
  }
  const deal = sectionDeal(themeId, seed, sectionIndex, opening, avoid);
  if (planned.size > 64) planned.clear();
  planned.set(key, deal);
  return deal;
}

export function openingRecord(themeId: ThemeId, seed: number): GameSample | null {
  const home = homeClusters(themeId, seed);
  const ordered = rank(themeId, seed, 0, 'DRUMS', home, leadCluster(themeId, seed, 0));
  return ordered[0] ?? null;
}

export function openingManifest(themeId: ThemeId, seed: number): GameSample[] {
  const opening = openingRecord(themeId, seed);
  const first = plannedStock(themeId, seed, 0);
  const manifest = opening ? [opening] : [];
  for (const layer of LOOP_LAYERS) manifest.push(...first[layer]);
  return dedupe(manifest);
}

export function lobbyForecast(themeId: ThemeId, seed: number): GameSample[] {
  const loaded = new Set(openingManifest(themeId, seed).map((entry) => entry.sampleName));
  const refills = LOOP_LAYERS.flatMap((layer) => dealRack(themeId, seed, 0, layer, { unavailable: loaded, count: 2 }));
  const next = plannedStock(themeId, seed, 1);
  const upcoming = LOOP_LAYERS.flatMap((layer) => next[layer]);
  return dedupe([...refills, ...upcoming]).filter((entry) => !loaded.has(entry.sampleName));
}

export function dedupe(samples: GameSample[]): GameSample[] {
  const seen = new Set<string>();
  return samples.filter((sample) => {
    if (seen.has(sample.sampleName)) return false;
    seen.add(sample.sampleName);
    return true;
  });
}
