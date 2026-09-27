import type { NexusEntity, SafeTransactionBuilder } from '@audiotool/nexus/document';
import {
  LAYER_LOW_CUT_HZ,
  LOOP_LAYERS,
  TICKS_PER_SIXTEENTH,
  authoredBpm,
  loopPlan,
  type GameSample,
  type LoopLayer,
  type SongRegion,
} from '@loop/shared';
import { chainTrimDb, fxKey, machineSpec, machinesOn } from './exportMachines';

export const TICKS_PER_BAR = TICKS_PER_SIXTEENTH * 16;

const MODE_RESAMPLE = 1;
const MODE_STRETCH = 2;

const CHAIN_STEP_X = 260;
const BUS_STEP_Y = 180;

export type ExportedRegion = {
  layer: LoopLayer;
  sampleName: string;
  positionTicks: number;
  durationTicks: number;
  offsetTicks: number;
  loopTicks: number;
  gain: number;
  timestretchMode: number;
  pitchShiftSemitones: number;
  bpm: number;
  machines: string[];
};

export function planRegion(region: SongRegion, sample: GameSample, themeBpm: number, sig: number | null): ExportedRegion {
  const plan = loopPlan(sample, themeBpm, sig);
  const loopTicks = Math.round(sample.bars * TICKS_PER_BAR);
  const positionTicks = Math.round(region.startBar * TICKS_PER_BAR);
  const gainDb = sample.gainDb + chainTrimDb(region.fx, themeBpm);
  return {
    layer: region.layer,
    sampleName: sample.sampleName,
    positionTicks,
    durationTicks: Math.round((region.endBar - region.startBar) * TICKS_PER_BAR),
    offsetTicks: loopTicks > 0 ? positionTicks % loopTicks : 0,
    loopTicks,
    gain: 10 ** (gainDb / 20),
    timestretchMode: plan.mode === 'stretch' ? MODE_STRETCH : MODE_RESAMPLE,
    pitchShiftSemitones: plan.mode === 'stretch' ? plan.semitones : 0,
    bpm: authoredBpm(sample),
    machines: machinesOn(region.fx),
  };
}

function setTempo(t: SafeTransactionBuilder, bpm: number, regions: SongRegion[]) {
  const bars = regions.reduce((end, region) => Math.max(end, region.endBar), 0);
  const durationTicks = Math.max(1, Math.round(bars * TICKS_PER_BAR));
  const existing = t.entities.ofTypes('config').getOne();
  if (existing) {
    t.update(existing.fields.tempoBpm, bpm);
    t.update(existing.fields.signatureNumerator, 4);
    t.update(existing.fields.signatureDenominator, 4);
    t.update(existing.fields.durationTicks, durationTicks);
    return;
  }
  const groove = t.create('groove', { displayName: 'Straight', impact: 0 });
  t.create('config', {
    tempoBpm: bpm,
    signatureNumerator: 4,
    signatureDenominator: 4,
    durationTicks,
    defaultGroove: groove.location,
  });
}

type Lookup = (sampleName: string) => GameSample | null;

type Bus = { track: NexusEntity<'audioTrack'>; label: string };

export function writeSong(
  t: SafeTransactionBuilder,
  regions: SongRegion[],
  lookup: Lookup,
  themeBpm: number,
  sig: number | null,
): ExportedRegion[] {
  const written: ExportedRegion[] = [];
  const buses = new Map<string, Bus>();

  setTempo(t, themeBpm, regions);

  for (const layer of LOOP_LAYERS) {
    for (const region of regions.filter((entry) => entry.layer === layer)) {
      const sample = lookup(region.sampleName);
      if (!sample || sample.bars <= 0) continue;
      const planned = planRegion(region, sample, themeBpm, sig);
      const plan = loopPlan(sample, themeBpm, sig);

      const machines = machinesOn(region.fx);
      const key = `${layer}|${fxKey(region.fx)}`;
      const existing = buses.get(key);
      const busLabel = machines.length === 0
        ? layer
        : `${layer} · ${machines.map((id) => machineSpec(id, themeBpm).label).join(' → ')}`;

      const entity = t.insertSample(
        { name: sample.sampleName, durationSeconds: plan.sourceSeconds, bpm: planned.bpm },
        {
          sample: { bpm: planned.bpm },
          region: { positionTicks: planned.positionTicks, durationTicks: planned.durationTicks },
          loop: true,
          attachTo: existing?.track,
          displayName: `${busLabel} · ${sample.name}`,
        },
      );
      const span = entity.fields.region.fields;
      t.update(span.loopOffsetTicks, -planned.offsetTicks);
      t.update(span.loopDurationTicks, planned.loopTicks);
      t.update(span.collectionOffsetTicks, 0);
      t.update(entity.fields.gain, planned.gain);
      t.update(entity.fields.timestretchMode, planned.timestretchMode);
      t.update(entity.fields.pitchShiftSemitones, planned.pitchShiftSemitones);

      if (!existing) {
        const created = t.entities.ofTypes('audioTrack').getEntity(entity.fields.track.value.entityId);
        if (created) {
          const track = created as NexusEntity<'audioTrack'>;
          buses.set(key, { track, label: busLabel });
          dressBus(t, track, layer, busLabel, machines, themeBpm, buses.size - 1);
        }
      }
      written.push(planned);
    }
  }

  const master = t.entities.ofTypes('mixerMaster').getOne() ?? t.create('mixerMaster', {});
  t.update(master.fields.limiterEnabled, true);
  return written;
}

function dressBus(
  t: SafeTransactionBuilder,
  track: NexusEntity<'audioTrack'>,
  layer: LoopLayer,
  label: string,
  machines: ReturnType<typeof machinesOn>,
  bpm: number,
  row: number,
) {
  const deviceId = track.fields.player.value.entityId;
  const device = t.entities.ofTypes('audioDevice').getEntity(deviceId);
  if (!device) return;
  t.update(device.fields.displayName, label);

  const cable = t.entities.ofTypes('desktopAudioCable').get()
    .find((entry) => entry.fields.fromSocket.value.entityId === deviceId);
  if (!cable) return;
  const channel = t.entities.ofTypes('mixerChannel').getEntity(cable.fields.toSocket.value.entityId);

  if (channel) {
    t.update(channel.fields.displayParameters.fields.displayName, label);
    t.update(channel.fields.preGain, 1);
    const hz = LAYER_LOW_CUT_HZ[layer];
    if (hz > 0) {
      t.update(channel.fields.trimFilter.fields.highPassCutoffFrequencyHz, hz);
      t.update(channel.fields.trimFilter.fields.isActive, true);
    }
  }

  if (machines.length === 0 || !channel) return;

  const baseX = device.fields.positionX.value;
  const baseY = device.fields.positionY.value + row * BUS_STEP_Y;
  const boxes = machines.map((id, index) => {
    const spec = machineSpec(id, bpm);
    return t.create(spec.type, {
      ...spec.fields,
      displayName: `${layer} · ${spec.label}`,
      positionX: baseX + (index + 1) * CHAIN_STEP_X,
      positionY: baseY,
      isActive: true,
    } as never);
  });

  t.update(cable.fields.toSocket, boxes[0]!.fields.audioInput.location);
  for (let index = 0; index + 1 < boxes.length; index += 1) {
    t.create('desktopAudioCable', {
      fromSocket: boxes[index]!.fields.audioOutput.location,
      toSocket: boxes[index + 1]!.fields.audioInput.location,
    });
  }
  t.create('desktopAudioCable', {
    fromSocket: boxes[boxes.length - 1]!.fields.audioOutput.location,
    toSocket: channel.fields.audioInput.location,
  });
}
