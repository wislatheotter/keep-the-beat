export type CrowdMove = readonly [clip: string, weight: number];

const CROWD_BASE: readonly CrowdMove[][] = [
  [['Crowd_L0_Bored_A', 1], ['Crowd_L0_Bored_B', 1]],
  [['Crowd_L1_Sway_A', 1], ['Crowd_L1_Sway_B', 1]],
  [['Crowd_L2_Nod_A', 1], ['Crowd_L2_Nod_B', 1]],
  [['Crowd_L3_Dance_A', 1], ['Crowd_L3_Dance_B', 1]],
  [['Crowd_L4_Bounce_A', 1], ['Crowd_L4_Bounce_B', 1]],
  [['Crowd_L5_HandsUp_A', 1], ['Crowd_L5_HandsUp_B', 1]],
];

const CROWD_FLAVOUR: Record<string, Partial<Record<number, readonly CrowdMove[]>>> = {
  disco: {
    1: [['Crowd_Snap', 1]],
    2: [['Crowd_Step', 1.5]],
    3: [['Crowd_Disco', 2], ['Crowd_Twist', 1.5], ['Crowd_ClapAlong', 1]],
    4: [['Crowd_Disco', 1.5], ['Crowd_Twist', 1]],
    5: [['Crowd_HandsWave', 1.5], ['Crowd_Jump', 1]],
  },
  house: {
    2: [['Crowd_Jack', 0.7], ['Crowd_Step', 1]],
    3: [['Crowd_Jack', 2], ['Crowd_Shuffle', 1], ['Crowd_ClapAlong', 0.7]],
    4: [['Crowd_FistPump', 0.7], ['Crowd_Shuffle', 1]],
    5: [['Crowd_HandsWave', 1], ['Crowd_Jump', 1]],
  },
  electro: {
    2: [['Crowd_Bop', 1]],
    3: [['Crowd_Headbang', 1], ['Crowd_Robot', 1.5]],
    4: [['Crowd_FistPump', 2], ['Crowd_Rave', 1]],
    5: [['Crowd_FistPump', 1], ['Crowd_Rave', 1]],
  },
  boombap: {
    1: [['Crowd_SwayArms', 0.5], ['Crowd_Snap', 1]],
    2: [['Crowd_L2_Nod_B', 1], ['Crowd_Rock', 1.5]],
    3: [['Crowd_Roof', 1], ['Crowd_Rock', 1], ['Crowd_Toprock', 1]],
    4: [['Crowd_Roof', 2], ['Crowd_Toprock', 1]],
  },
  dnb: {
    2: [['Crowd_Bop', 1]],
    3: [['Crowd_Skank', 2], ['Crowd_Shuffle', 1]],
    4: [['Crowd_Skank', 2], ['Crowd_Headbang', 1], ['Crowd_Rave', 1]],
    5: [['Crowd_FistPump', 0.5], ['Crowd_Rave', 1]],
  },
  techhouse: {
    2: [['Crowd_Bop', 1], ['Crowd_Step', 0.7]],
    3: [['Crowd_Jack', 1.5], ['Crowd_Shuffle', 1]],
    4: [['Crowd_FistPump', 1.5], ['Crowd_Jack', 0.5], ['Crowd_Stomp', 1]],
  },
  techno: {
    2: [['Crowd_Rock', 1]],
    3: [['Crowd_Headbang', 2], ['Crowd_Robot', 1], ['Crowd_Stomp', 1]],
    4: [['Crowd_FistPump', 2], ['Crowd_Headbang', 1], ['Crowd_Stomp', 1.5]],
    5: [['Crowd_FistPump', 1.5], ['Crowd_Rave', 1]],
  },
  trance: {
    1: [['Crowd_SwayArms', 1.5]],
    2: [['Crowd_SwayArms', 0.7], ['Crowd_Step', 0.7]],
    3: [['Crowd_ClapAlong', 1]],
    4: [['Crowd_FistPump', 1], ['Crowd_Rave', 1]],
    5: [['Crowd_HandsWave', 2.5], ['Crowd_Jump', 1]],
  },
  ukg: {
    1: [['Crowd_Snap', 1]],
    2: [['Crowd_Step', 1.5], ['Crowd_Bop', 1]],
    3: [['Crowd_Skank', 1.5], ['Crowd_Jack', 1], ['Crowd_Twist', 1]],
    4: [['Crowd_Skank', 1], ['Crowd_Shuffle', 1]],
  },
  triphop: {
    1: [['Crowd_SwayArms', 2], ['Crowd_Snap', 1]],
    2: [['Crowd_SwayArms', 1.5], ['Crowd_Rock', 1.5]],
    3: [['Crowd_Roof', 0.7], ['Crowd_Rock', 1], ['Crowd_Bop', 1]],
    4: [['Crowd_SwayArms', 1]],
  },
};

export function crowdMoves(themeId: string): readonly CrowdMove[][] {
  const flavour = CROWD_FLAVOUR[themeId] ?? {};
  return CROWD_BASE.map((base, level) => [...base, ...(flavour[level] ?? [])]);
}

export const CROWD_STYLE_CLIPS: readonly string[] = [
  ...new Set(
    [...CROWD_BASE.flat(), ...Object.values(CROWD_FLAVOUR).flatMap((levels) => Object.values(levels).flatMap((moves) => moves ?? []))]
      .map(([clip]) => clip),
  ),
];

export type DanceSet = readonly [low: readonly string[], mid: readonly string[], high: readonly string[]];

const PERFORMER_DANCES: Record<string, DanceSet> = {
  disco: [['Dance_Nod', 'Dance_Step', 'Dance_Snap'], ['Dance_Groove', 'Dance_Twist', 'Dance_Clap'], ['Dance_Disco', 'Dance_Jump', 'Dance_Kick']],
  house: [['Dance_Nod', 'Dance_Step', 'Dance_Bop'], ['Dance_Jack', 'Dance_Shuffle', 'Dance_Clap'], ['Dance_Hype', 'Dance_Kick', 'Dance_Jump']],
  electro: [['Dance_Nod', 'Dance_Bop', 'Dance_Rock'], ['Dance_Skank', 'Dance_Robot', 'Dance_Jack'], ['Dance_Pump', 'Dance_Rave', 'Dance_Stomp']],
  boombap: [['Dance_Nod', 'Dance_Snap', 'Dance_Bop'], ['Dance_Groove', 'Dance_Rock', 'Dance_Clap'], ['Dance_Bounce', 'Dance_Toprock', 'Dance_Pump']],
  dnb: [['Dance_Nod', 'Dance_Bop', 'Dance_Step'], ['Dance_Skank', 'Dance_Shuffle', 'Dance_Rock'], ['Dance_Hype', 'Dance_Rave', 'Dance_Stomp']],
  techhouse: [['Dance_Nod', 'Dance_Bop', 'Dance_Step'], ['Dance_Jack', 'Dance_Shuffle', 'Dance_Groove'], ['Dance_Pump', 'Dance_Kick', 'Dance_Rave']],
  techno: [['Dance_Nod', 'Dance_Rock', 'Dance_Bop'], ['Dance_Groove', 'Dance_Robot', 'Dance_Jack'], ['Dance_Pump', 'Dance_Stomp', 'Dance_Rave']],
  trance: [['Dance_Nod', 'Dance_Sway', 'Dance_Float'], ['Dance_Groove', 'Dance_Float', 'Dance_Clap'], ['Dance_Wave', 'Dance_Jump', 'Dance_Rave']],
  ukg: [['Dance_Nod', 'Dance_Snap', 'Dance_Step'], ['Dance_Skank', 'Dance_Twist', 'Dance_Shuffle'], ['Dance_Jack', 'Dance_Kick', 'Dance_Hype']],
  triphop: [['Dance_Sway', 'Dance_Float', 'Dance_Snap'], ['Dance_Nod', 'Dance_Bop', 'Dance_Step'], ['Dance_Bounce', 'Dance_Groove', 'Dance_Rock']],
};
const DEFAULT_DANCES: DanceSet = [['Dance_Nod', 'Dance_Step'], ['Dance_Groove', 'Dance_Clap'], ['Dance_Hype', 'Dance_Jump']];

export function performerDances(themeId: string): DanceSet {
  return PERFORMER_DANCES[themeId] ?? DEFAULT_DANCES;
}

export const PERFORMER_STYLE_CLIPS: readonly string[] = [
  ...new Set([...Object.values(PERFORMER_DANCES), DEFAULT_DANCES].flatMap((set) => set.flat())),
];

const PHRASE_BARS = 8;

export function danceAt(dances: readonly string[], playerId: string, bar: number): string {
  if (dances.length === 1) return dances[0]!;
  const seed = hash(playerId);
  const phrase = Math.floor(bar / PHRASE_BARS);
  let index = seed % dances.length;
  for (let p = 0; p < phrase; p += 1) index += 1 + (mix(seed, p) % (dances.length - 1));
  return dances[index % dances.length]!;
}

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mix(seed: number, n: number) {
  let h = Math.imul(seed ^ Math.imul(n + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function danceBand(energy: number, current: number): number {
  const up = [0.3, 0.58];
  const down = [0.24, 0.52];
  let band = current;
  while (band < 2 && energy >= up[band]!) band += 1;
  while (band > 0 && energy < down[band - 1]!) band -= 1;
  return band;
}
