import { create } from 'zustand';
import { Vector3 } from 'three';
import {
  DECK_USE_RADIUS,
  PICKUP_RADIUS,
  RECORD_REACH,
  STATION_USE_RADIUS,
  msUntilPrintable,
  canPrint,
  deckDistance,
  handingBack,
  distanceXZ,
  isOnDeck,
  isAtSongArc,
  SECTION_PLAN,
  nearestPlatter,
  nearestStation,
  recordOnPlatter,
  STATION_BY_ID,
  sample as gameSample,
  stationAvailability,
  stationExit,
  type BlockState,
  type GameState,
  type LoopLayer,
  type StationDefinition,
  type Vec3,
} from '@loop/shared';

export type Interaction =
  | { kind: 'place'; layer: LoopLayer; label: string; icon: string; hint: string }
  | { kind: 'eject'; layer: LoopLayer; label: string; icon: string; hint: string }
  | { kind: 'print'; label: string; icon: string; hint: string }
  | { kind: 'wait'; label: string; icon: string; hint: string }
  | { kind: 'process'; station: StationDefinition; label: string; icon: string; hint: string }
  | { kind: 'blocked'; station: StationDefinition | null; label: string; icon: string; hint: string }
  | { kind: 'take'; block: BlockState; station: StationDefinition | null; label: string; icon: string; hint: string }
  | { kind: 'drop'; label: string; icon: string; hint: string }
  | { kind: 'idle'; label: string; icon: string; hint: string };

export function reachableRecord(
  state: GameState,
  playerId: string,
  reach = RECORD_REACH,
  at: Vec3 | null = null,
  now = state.serverNow,
): BlockState | null {
  const player = state.players[playerId];
  if (!player || player.heldBlockId) return null;
  const from = at ?? player.position;
  let best: BlockState | null = null;
  let bestDistance = Infinity;
  for (const block of Object.values(state.blocks)) {
    let where = block.position;
    let limit = reach;
    if (block.status === 'station') {
      const machine = handingBack(state, block, now);
      if (!machine) continue;
      where = stationExit(machine);
      limit = RECORD_REACH;
    } else if (block.status === 'thrown') {
      if (block.holderId && isOnDeck(block.position)) continue;
      if (!block.holderId) limit = RECORD_REACH;
    } else if (block.status !== 'racked' && block.status !== 'world') continue;
    if (block.status === 'racked' && block.slot !== 0) continue;
    const distance = distanceXZ(from, where);
    const bias = block.status === 'racked' ? -0.35 : 0;
    if (distance + bias > limit) continue;
    if (distance + bias <= bestDistance) { best = block; bestDistance = distance + bias; }
  }
  return best;
}

export function resolveInteraction(state: GameState, playerId: string, now: number, at: Vec3 | null = null): Interaction {
  const me = state.players[playerId];
  if (!me) return { kind: 'idle', label: '—', icon: '·', hint: '' };
  const position = at ?? me.position;
  const held = me.heldBlockId ? state.blocks[me.heldBlockId] : null;
  const onDeck = deckDistance(position) <= DECK_USE_RADIUS;
  const station = nearestStation(position, STATION_USE_RADIUS)?.station ?? null;

  if (held) {
    const entry = gameSample(held.sampleName);
    if (onDeck) {
      const layer = held.role as LoopLayer;
      const occupied = recordOnPlatter(state, layer);
      return { kind: 'place', layer, label: occupied ? 'SWAP IT IN' : 'PUT IT ON', icon: '＋', hint: `${held.role} · NEXT PHRASE` };
    }
    if (station && station.kind !== 'rack') {
      const availability = stationAvailability(state, playerId, station.id, now);
      if (availability.ok) return { kind: 'process', station, label: station.verb, icon: '↧', hint: station.label };
      return { kind: 'blocked', station, label: availability.reason?.toUpperCase() ?? 'WAIT', icon: '⊘', hint: station.label };
    }
    return { kind: 'drop', label: 'PUT DOWN', icon: '↗', hint: entry ? 'HOLD TO THROW' : '' };
  }

  const record = reachableRecord(state, playerId, (onDeck || isAtSongArc(position)) ? PICKUP_RADIUS : RECORD_REACH, position, now);
  if (record) {
    const entry = gameSample(record.sampleName);
    return {
      kind: 'take',
      block: record,
      station: record.status === 'racked' && record.rackId ? STATION_BY_ID[record.rackId] ?? null : null,
      label: record.status === 'racked' ? 'TAKE IT' : 'PICK UP',
      icon: '✦',
      hint: entry?.name ?? record.role,
    };
  }

  if (isAtSongArc(position)) {
    const section = SECTION_PLAN[state.song.sectionIndex];
    if (!canPrint(state, now)) {
      const seconds = Math.ceil(msUntilPrintable(state, now) / 1000);
      return { kind: 'wait', label: 'LET IT RUN', icon: '◴', hint: `${seconds}S BEFORE YOU CAN PRINT` };
    }
    return { kind: 'print', label: 'HOLD TO PRINT', icon: '⏻', hint: `${section?.name ?? 'SECTION'} · SONG ARC` };
  }

  if (onDeck) {
    const layer = nearestPlatter(position);
    if (recordOnPlatter(state, layer)) {
      return {
        kind: 'eject',
        layer,
        label: 'EJECT',
        icon: '↥',
        hint: `${layer} OFF`,
      };
    }
    return { kind: 'idle', label: 'BRING A RECORD', icon: '·', hint: 'PRINT AT THE SONG ARC · FRONT OF STAGE' };
  }

  if (station && station.kind !== 'rack') {
    if (state.stations[station.id]!.busyUntil > now) {
      return { kind: 'blocked', station, label: 'WORKING', icon: '◌', hint: station.label };
    }
    return { kind: 'blocked', station: null, label: 'BRING A RECORD', icon: '·', hint: station.label };
  }
  return { kind: 'idle', label: 'FIND A RECORD', icon: '·', hint: 'RECORD STACKS ARE ALONG THE BACK' };
}

export type Focus = {
  key: string;
  kind: Interaction['kind'];
  blockId: string | null;
  layer: LoopLayer | null;
  stationId: string | null;
  lever: boolean;
};

export const NO_FOCUS: Focus = { key: 'none', kind: 'idle', blockId: null, layer: null, stationId: null, lever: false };

export function focusOf(interaction: Interaction): Focus {
  switch (interaction.kind) {
    case 'take':
      return {
        key: `take:${interaction.block.id}`,
        kind: 'take',
        blockId: interaction.block.id,
        layer: null,
        stationId: interaction.station?.id ?? null,
        lever: false,
      };
    case 'place':
      return { key: `place:${interaction.layer}`, kind: 'place', blockId: null, layer: interaction.layer, stationId: null, lever: false };
    case 'eject':
      return { key: `eject:${interaction.layer}`, kind: 'eject', blockId: null, layer: interaction.layer, stationId: null, lever: false };
    case 'process':
      return { key: `process:${interaction.station.id}`, kind: 'process', blockId: null, layer: null, stationId: interaction.station.id, lever: false };
    case 'print':
      return { key: 'print', kind: 'print', blockId: null, layer: null, stationId: null, lever: true };
    default:
      return NO_FOCUS;
  }
}

type FocusState = {
  focus: Focus;
  interaction: Interaction | null;
  set: (interaction: Interaction) => void;
  clear: () => void;
};

export const useFocusStore = create<FocusState>((set, get) => ({
  focus: NO_FOCUS,
  interaction: null,
  set: (interaction) => {
    const focus = focusOf(interaction);
    const previous = get().interaction;
    if (previous && focus.key === get().focus.key && previous.label === interaction.label && previous.hint === interaction.hint) return;
    set({ focus, interaction });
  },
  clear: () => {
    if (get().focus === NO_FOCUS && get().interaction === null) return;
    set({ focus: NO_FOCUS, interaction: null });
  },
}));

export const livePlayer = {
  position: new Vector3(),
  known: false,
  publish: null as null | (() => void),
  replayX: 0,
};
