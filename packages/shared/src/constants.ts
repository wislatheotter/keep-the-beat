import type { LoopLayer, SampleRole } from './themes.js';
import type { StationKind } from './types.js';

export const ARENA_RADIUS = 17.5;
export const PLAYER_RADIUS_LIMIT = ARENA_RADIUS - 0.9;
export const BLOCK_RADIUS_LIMIT = ARENA_RADIUS - 0.6;

export const CROWD_RADIUS = ARENA_RADIUS + 1.6;

export const CROWD_FLOOR_Y = -0.55;

export const MAX_PLAYERS = 5;

export const PLAYER_Y = 0.75;
export const BLOCK_REST_Y = 0.82;
export const PLAYER_SPEED = 8.85;

export const SHOW_REGULAR_MS = 600_000;

export const SHOW_OVERTIME_MS = 45_000;

export const SHOW_INTRO_MS = 2800;

export const REPLAY_INTRO_MS = 3400;
export const REPLAY_GAP_BARS = 2;
export const REPLAY_HALF_WIDTH = 7;
export const REPLAY_SPACING = 2.5;
export const JUMP_MS = 640;
export const JUMP_HEIGHT = 1.75;


export const DECK_POSITION = { x: 0, y: 0, z: 3 } as const;
export const PLATTER_RADIUS = 4.0;
export const PLATTER_Y = 1.5;
export const DECK_RING_RADIUS = 6.0;
export const DECK_PLINTH_RADIUS = 6.5;
export const DECK_COLLISION_RADIUS = DECK_PLINTH_RADIUS + 0.1;
export const DECK_USE_RADIUS = DECK_PLINTH_RADIUS + 1.35;
export const DECK_CATCH_RADIUS = DECK_PLINTH_RADIUS + 1.1;

export const PLATTER_BEARING: Record<LoopLayer, number> = {
  DRUMS: 0.125,
  BASS: 0.875,
  MUSIC: 0.625,
  TOPS: 0.375,
};

export const COMMIT_HOLD_SECONDS = 0.7;

export const MIN_SECTION_MS = 1000;

export const RECORD_REACH = 4.05;
export const PICKUP_RADIUS = 2.1;
export const TICKS_PER_SIXTEENTH = 960;

export const FLOOR_LIFETIME_MS = 10_000;
export const FLOOR_WARNING_MS = 3_200;

export const LOB_POWER_MIN = 6;
export const LOB_POWER_MAX = 14;
export const LOB_POWER_UNDRAGGED = 10;
export const LOB_ELEVATION_DEG = 30;
export const FALL_ACCEL = 11.5;

export const EJECT_LAUNCH_Y = 1.45;
export const EJECT_LAUNCH_SPEED_Y = 4.6;
export const EJECT_DISTANCE = 3.6;
export const EJECT_INWARD = 0.65;

export const DECK_EJECT_SPEED_Y = 5.6;
export const DECK_EJECT_DISTANCE = 4.1;

export type StationDefinition = {
  id: string;
  kind: StationKind;
  label: string;
  verb: string;
  angle: number;
  radius: number;
  facing?: number;
  role?: SampleRole;
};

export const STATION_USE_RADIUS = 2.9;

export const STATION_HANDOFF_AT = 0.84;

export const MACHINE_CATCH_MARGIN = 0.45;
export const MACHINE_CATCH_Y = 3.2;

export const RACK_SLOTS = 3;

export const RACK_STACK_FORWARD = 1.19;
export const RACK_STACK_Y = 1.9;
export const RACK_STACK_STEP = 0.06;

const turns = (value: number) => value * Math.PI * 2;
const TUNNEL_HALF_LENGTH = 1.85;

export const BACKLINE_RADIUS = 15;
export const MACHINE_RADIUS = 16;
const BACK = 0.5;
const arc = (metres: number, radius: number) => metres / radius / (Math.PI * 2);
const STATION_GAP = 2.3;
export const STATION_VISUAL_HALF: Record<StationKind, number> = {
  rack: 1.8,
  echo: TUNNEL_HALF_LENGTH,
  crusher: 1.3,
  filter: 1.2,
  space: 1.4,
  wide: 1.525,
  swirl: 1.4,
  warp: 1.45,
  washer: 1.45,
};
const RACK_PITCH = arc(STATION_VISUAL_HALF.rack * 2 + STATION_GAP, BACKLINE_RADIUS);
const RACK_EDGE = RACK_PITCH * 1.5 + arc(STATION_VISUAL_HALF.rack, BACKLINE_RADIUS);
const after = (previousCentre: number, previousHalf: number, nextHalf: number) =>
  previousCentre + previousHalf + STATION_GAP + nextHalf;

const ECHO_ANGLE = RACK_EDGE + arc(STATION_GAP + STATION_VISUAL_HALF.echo, MACHINE_RADIUS);
const ECHO_METRES = ECHO_ANGLE * MACHINE_RADIUS * Math.PI * 2;
const SPACE_METRES = after(ECHO_METRES, STATION_VISUAL_HALF.echo, STATION_VISUAL_HALF.space);
const SWIRL_METRES = after(SPACE_METRES, STATION_VISUAL_HALF.space, STATION_VISUAL_HALF.swirl);
const WASHER_METRES = after(SWIRL_METRES, STATION_VISUAL_HALF.swirl, STATION_VISUAL_HALF.washer);

const CRUSHER_ANGLE = RACK_EDGE + arc(STATION_GAP + STATION_VISUAL_HALF.crusher, MACHINE_RADIUS);
const CRUSHER_METRES = CRUSHER_ANGLE * MACHINE_RADIUS * Math.PI * 2;
const FILTER_METRES = after(CRUSHER_METRES, STATION_VISUAL_HALF.crusher, STATION_VISUAL_HALF.filter);
const WIDE_METRES = after(FILTER_METRES, STATION_VISUAL_HALF.filter, STATION_VISUAL_HALF.wide);
const WARP_METRES = after(WIDE_METRES, STATION_VISUAL_HALF.wide, STATION_VISUAL_HALF.warp);

export const STATIONS: StationDefinition[] = [
  { id: 'st-rack-drums', kind: 'rack', role: 'DRUMS', label: 'DRUMS', verb: 'TAKE', angle: turns(BACK - RACK_PITCH * 1.5), radius: BACKLINE_RADIUS },
  { id: 'st-rack-bass', kind: 'rack', role: 'BASS', label: 'BASS', verb: 'TAKE', angle: turns(BACK - RACK_PITCH * 0.5), radius: BACKLINE_RADIUS },
  { id: 'st-rack-music', kind: 'rack', role: 'MUSIC', label: 'MUSIC', verb: 'TAKE', angle: turns(BACK + RACK_PITCH * 0.5), radius: BACKLINE_RADIUS },
  { id: 'st-rack-tops', kind: 'rack', role: 'TOPS', label: 'TOPS', verb: 'TAKE', angle: turns(BACK + RACK_PITCH * 1.5), radius: BACKLINE_RADIUS },
  { id: 'st-echo', kind: 'echo', label: 'ECHO CHAMBER', verb: 'INSERT', angle: turns(BACK + ECHO_ANGLE), radius: MACHINE_RADIUS },
  { id: 'st-crusher', kind: 'crusher', label: 'CRUSHER', verb: 'INSERT', angle: turns(BACK - CRUSHER_ANGLE), radius: MACHINE_RADIUS },
  { id: 'st-filter', kind: 'filter', label: 'FILTER', verb: 'INSERT', angle: turns(BACK - arc(FILTER_METRES, MACHINE_RADIUS)), radius: MACHINE_RADIUS },
  { id: 'st-space', kind: 'space', label: 'SPACE', verb: 'INSERT', angle: turns(BACK + arc(SPACE_METRES, MACHINE_RADIUS)), radius: MACHINE_RADIUS, facing: .92 },
  { id: 'st-swirl', kind: 'swirl', label: 'SWIRL', verb: 'INSERT', angle: turns(BACK + arc(SWIRL_METRES, MACHINE_RADIUS)), radius: MACHINE_RADIUS, facing: 1.0 },
  { id: 'st-washer', kind: 'washer', label: 'WASHER', verb: 'INSERT', angle: turns(BACK + arc(WASHER_METRES, MACHINE_RADIUS)), radius: MACHINE_RADIUS, facing: 1.05 },
  { id: 'st-wide', kind: 'wide', label: 'WIDE', verb: 'INSERT', angle: turns(BACK - arc(WIDE_METRES, MACHINE_RADIUS)), radius: MACHINE_RADIUS, facing: -1.0 },
  { id: 'st-warp', kind: 'warp', label: 'WARP', verb: 'INSERT', angle: turns(BACK - arc(WARP_METRES, MACHINE_RADIUS)), radius: MACHINE_RADIUS, facing: -1.05 },
];

export const RACKS = STATIONS.filter((station) => station.kind === 'rack');

export const ECHO_TRAVEL_MS = 1800;
export const CRUSH_MS = 1600;
export const FILTER_MS = 1900;

export const STATION_RELEASE_Y = { echo: 1.15, crusher: 1.173, filter: 3.24, rack: 1.45,
  space: 1.48, wide: 1.36, swirl: 1.72, warp: 1.7, washer: 1.28 } as const;

export const GENERIC_MACHINES = ['space', 'wide', 'swirl', 'warp', 'washer'] as const;
export type GenericMachineKind = typeof GENERIC_MACHINES[number];
export function isGenericMachine(kind: StationKind): kind is GenericMachineKind {
  return (GENERIC_MACHINES as readonly StationKind[]).includes(kind);
}
export const MACHINE_ACCENTS: Record<Exclude<StationKind, 'rack'>, string> = {
  echo: '#6cdeed', crusher: '#ff9d5c', filter: '#c2a0ff',
  space: '#79ddff', wide: '#ffe982', swirl: '#77ffd0', warp: '#ff9bdd', washer: '#a6f5ff',
};

export const TUNNEL_HALF = TUNNEL_HALF_LENGTH;

export const STATION_BODY_RADIUS: Record<StationKind, number> = {
  rack: 1.75,
  echo: 1.15,
  crusher: 1.4,
  filter: 1.3,
  space: 1.4, wide: 1.45, swirl: 1.4, warp: 1.45, washer: 1.45,
};

export const STATION_BODY_HALF: Record<StationKind, number> = {
  rack: 1.45,
  echo: TUNNEL_HALF,
  crusher: 0,
  filter: 0,
  space: 0, wide: .25, swirl: 0, warp: 0, washer: 0,
};

export const STATION_BY_ID: Record<string, StationDefinition> =
  Object.fromEntries(STATIONS.map((station) => [station.id, station]));


export const PLAYER_COLORS = ['#72f1b8', '#ff7ab2', '#7aa2ff', '#ffd866', '#c792ea'];
