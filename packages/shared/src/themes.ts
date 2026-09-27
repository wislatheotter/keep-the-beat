import { THEME_KITS } from './themeKits.generated.js';
import { LOOP_LAYERS, type GameSample, type LoopLayer, type SampleRole, type ThemeKit } from './themeTypes.js';

export type ThemeId = string;

export type ThemeLook = {
  night: string;
  fogNear: number;
  fogFar: number;
  sky: string;
  ground: string;
  key: string;
  keyGain: number;
  accent: string;
  secondary: string;
  floorA: string;
  floorB: string;
  tile: number;
  litGain: number;
  sweepGain: number;
  sparkle: number;
};

const LOOKS: Record<string, ThemeLook> = {
  disco: {
    night: '#0d0710', fogNear: 1.7, fogFar: 4.1,
    sky: '#cbbdff', ground: '#261632', key: '#f4eaff', keyGain: 0.96,
    accent: '#ff38b5', secondary: '#ffbc32',
    floorA: '#2d1226', floorB: '#4a1f36', tile: 2.4, litGain: 1.15, sweepGain: 0.9, sparkle: 1.4,
  },
  house: {
    night: '#05070f', fogNear: 1.5, fogFar: 3.6,
    sky: '#9db4ff', ground: '#161a34', key: '#dfe6ff', keyGain: 0.92,
    accent: '#5de0ff', secondary: '#a06bff',
    floorA: '#0d1330', floorB: '#182452', tile: 1.7, litGain: 1.0, sweepGain: 1.2, sparkle: 1.1,
  },
  electro: {
    night: '#04060a', fogNear: 1.9, fogFar: 4.6,
    sky: '#c6fbff', ground: '#0b2230', key: '#eafcff', keyGain: 1.0,
    accent: '#57ff9d', secondary: '#ff4f91',
    floorA: '#07202a', floorB: '#0e3947', tile: 1.35, litGain: 1.3, sweepGain: 1.5, sparkle: 1.5,
  },
  boombap: {
    night: '#0b0806', fogNear: 1.6, fogFar: 3.9,
    sky: '#ffdca8', ground: '#33240f', key: '#ffeccd', keyGain: 1.0,
    accent: '#ffb347', secondary: '#8f7bff',
    floorA: '#251a10', floorB: '#3d2a17', tile: 2.9, litGain: 0.85, sweepGain: 0.55, sparkle: 0.7,
  },
  dnb: {
    night: '#050d0a', fogNear: 1.35, fogFar: 3.3,
    sky: '#b6ffe0', ground: '#0f2a22', key: '#dcfff2', keyGain: 0.88,
    accent: '#9dff5d', secondary: '#ff5470',
    floorA: '#0a2119', floorB: '#123a2b', tile: 1.15, litGain: 1.25, sweepGain: 1.7, sparkle: 1.3,
  },
  techhouse: {
    night: '#07070a', fogNear: 1.5, fogFar: 3.5,
    sky: '#ffd6a0', ground: '#221a12', key: '#fff0dc', keyGain: 0.9,
    accent: '#ff9a3d', secondary: '#58a8ff',
    floorA: '#1b140e', floorB: '#2e2217', tile: 1.5, litGain: 1.05, sweepGain: 1.25, sparkle: 0.9,
  },
  techno: {
    night: '#030303', fogNear: 1.3, fogFar: 3.1,
    sky: '#ff9d9d', ground: '#1b0a0a', key: '#ffe3e3', keyGain: 0.84,
    accent: '#ff2e3f', secondary: '#9aa4ff',
    floorA: '#140707', floorB: '#260c0e', tile: 1.3, litGain: 1.3, sweepGain: 1.6, sparkle: 0.7,
  },
  trance: {
    night: '#03061a', fogNear: 2.0, fogFar: 4.8,
    sky: '#a8d4ff', ground: '#0c1a3a', key: '#e3f1ff', keyGain: 1.02,
    accent: '#4da6ff', secondary: '#ff7ae6',
    floorA: '#0a1430', floorB: '#12245a', tile: 1.8, litGain: 1.2, sweepGain: 1.3, sparkle: 1.7,
  },
  ukg: {
    night: '#070b08', fogNear: 1.6, fogFar: 3.8,
    sky: '#c9ffd8', ground: '#132a1c', key: '#eafff1', keyGain: 0.92,
    accent: '#3dffa0', secondary: '#ffb84d',
    floorA: '#0e2015', floorB: '#173524', tile: 1.45, litGain: 1.1, sweepGain: 1.2, sparkle: 1.1,
  },
  triphop: {
    night: '#06060a', fogNear: 1.4, fogFar: 3.4,
    sky: '#c4b6d9', ground: '#1b1824', key: '#ece6f5', keyGain: 0.82,
    accent: '#9f8bd1', secondary: '#d1a35c',
    floorA: '#14121c', floorB: '#221e30', tile: 2.6, litGain: 0.65, sweepGain: 0.4, sparkle: 0.55,
  },
};

const FALLBACK_LOOK = LOOKS.house!;

export type Theme = ThemeKit & { look: ThemeLook };

export const THEMES: Theme[] = THEME_KITS.map((kit) => ({ ...kit, look: LOOKS[kit.id] ?? FALLBACK_LOOK }));

export const THEME_IDS: ThemeId[] = THEMES.map((theme) => theme.id);

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export function theme(id: ThemeId): Theme {
  return THEME_BY_ID.get(id) ?? THEMES[0]!;
}

const THEME_SAMPLE_INDEX = new Map<string, Map<string, GameSample>>();
const ANY_THEME_INDEX = new Map<string, GameSample>();
for (const kit of THEMES) {
  const index = new Map<string, GameSample>();
  for (const entry of kit.samples) {
    index.set(entry.sampleName, entry);
    if (!ANY_THEME_INDEX.has(entry.sampleName)) ANY_THEME_INDEX.set(entry.sampleName, entry);
  }
  THEME_SAMPLE_INDEX.set(kit.id, index);
}

let activeThemeId: ThemeId | null = null;
export function setActiveTheme(themeId: ThemeId | null) {
  activeThemeId = themeId;
}

export function sample(sampleName: string | null, themeId: ThemeId | null = activeThemeId): GameSample | null {
  if (!sampleName) return null;
  const inTheme = themeId ? THEME_SAMPLE_INDEX.get(themeId)?.get(sampleName) : undefined;
  return inTheme ?? ANY_THEME_INDEX.get(sampleName) ?? null;
}

const BY_ROLE = new Map<string, Record<SampleRole, GameSample[]>>();
for (const kit of THEMES) {
  const grouped = { DRUMS: [], BASS: [], MUSIC: [], TOPS: [], SPECIAL: [] } as Record<SampleRole, GameSample[]>;
  for (const entry of kit.samples) grouped[entry.role].push(entry);
  BY_ROLE.set(kit.id, grouped);
}

export function samplesFor(themeId: ThemeId, role: SampleRole): GameSample[] {
  return BY_ROLE.get(theme(themeId).id)?.[role] ?? [];
}

export function packsOf(themeId: ThemeId): Array<{ pack: string; label: string; count: number }> {
  const counts = new Map<string, { label: string; count: number }>();
  for (const entry of theme(themeId).samples) {
    const existing = counts.get(entry.pack);
    if (existing) existing.count += 1;
    else counts.set(entry.pack, { label: entry.packLabel, count: 1 });
  }
  return [...counts.entries()]
    .map(([pack, value]) => ({ pack, ...value }))
    .sort((a, b) => b.count - a.count);
}

export const LAYER_COLORS: Record<SampleRole, string> = {
  DRUMS: '#ff4f7d',
  BASS: '#8b6bff',
  MUSIC: '#3ddc97',
  TOPS: '#ffcf4d',
  SPECIAL: '#4dd8ff',
};

export const LAYER_LABEL: Record<SampleRole, string> = {
  DRUMS: 'DRUMS',
  BASS: 'BASS',
  MUSIC: 'MUSIC',
  TOPS: 'TOPS',
  SPECIAL: 'SPECIAL',
};

export const FAMILY_GLYPH: Record<string, string> = {
  kit: '◍', break: '◈', stomp: '▣',
  sub: '●', bassline: '◐', growl: '◎',
  keys: '▤', pad: '▬', riff: '≋', guitar: '⌇', synth: '◇',
  hats: '✦', perc: '◌', sparkle: '✳',
  vox: '☺', scratch: '↯', fx: '⟁', stab: '◆', hit: '✱',
};

export { LOOP_LAYERS };
export type { LoopLayer, SampleRole, GameSample, ThemeKit };
