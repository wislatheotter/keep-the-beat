import type { FxId, FxSet } from '@loop/shared';

export type MachineDevice =
  | 'stompboxSlope'
  | 'stompboxTube'
  | 'stompboxDelay'
  | 'stompboxReverb'
  | 'stompboxStereoDetune'
  | 'stompboxPhaser'
  | 'stompboxPitchDelay';

export type MachineSpec = {
  type: MachineDevice;
  label: string;
  fields: Record<string, number>;
  trimDb: number;
};

const STEP_BARS = [0, 1 / 16, 1 / 12, 1 / 8];

const barSeconds = (bpm: number) => 240 / bpm;

export function echoSteps(bpm: number): { stepCount: number; stepLengthIndex: number; seconds: number } {
  const target = 0.26;
  let best = { stepCount: 1, stepLengthIndex: 3, seconds: 0 };
  let error = Infinity;
  for (let stepLengthIndex = 1; stepLengthIndex <= 3; stepLengthIndex += 1) {
    for (let stepCount = 1; stepCount <= 7; stepCount += 1) {
      const seconds = stepCount * STEP_BARS[stepLengthIndex]! * barSeconds(bpm);
      const miss = Math.abs(seconds - target);
      if (miss < error) { error = miss; best = { stepCount, stepLengthIndex, seconds }; }
    }
  }
  return best;
}

const asMix = (send: number) => send / (1 + send);

export function machineSpec(fx: FxId, bpm: number): MachineSpec {
  switch (fx) {
    case 'filter':
      return {
        type: 'stompboxSlope',
        label: 'SHADE',
        fields: { filterModeIndex: 1, frequencyHz: 620, resonanceFactor: 0.35, mix: 1 },
        trimDb: 20 * Math.log10(1.45),
      };

    case 'crush':
      return {
        type: 'stompboxTube',
        label: 'CRUNCH',
        fields: { drive: 10, tone: -6, postGain: 0.4 },
        trimDb: 2,
      };

    case 'reverb': {
      const { stepCount, stepLengthIndex } = echoSteps(bpm);
      return {
        type: 'stompboxDelay',
        label: 'ECHO',
        fields: { stepCount, stepLengthIndex, feedbackFactor: 0.42, mix: asMix(0.55) },
        trimDb: 0,
      };
    }

    case 'space':
      return {
        type: 'stompboxReverb',
        label: 'SPACE',
        fields: {
          roomSizeFactor: 0.8,
          preDelayTimeMs: 60,
          feedbackFactor: 0.667,
          dampFactor: 0.5,
          mix: 0.3,
        },
        trimDb: 0,
      };

    case 'wide':
      return {
        type: 'stompboxStereoDetune',
        label: 'WIDE',
        fields: { detuneSemitones: 0.35, delayTimeMs: 14 },
        trimDb: 0,
      };

    case 'swirl':
      return {
        type: 'stompboxPhaser',
        label: 'SWIRL',
        fields: {
          minFrequencyHz: 240,
          maxFrequencyHz: 3000,
          feedbackFactor: 0.7,
          lfoFrequencyHz: 0.6,
          mix: 0.5,
        },
        trimDb: 0,
      };

    case 'warp':
      return {
        type: 'stompboxPitchDelay',
        label: 'WARP',
        fields: {
          stepCount: 3,
          stepLengthIndex: 1,
          feedbackFactor: 0.666,
          tuneFactor: 7 / 12,
          mix: 0.38,
        },
        trimDb: 0,
      };
  }
}

export const CHAIN_ORDER: readonly FxId[] = ['filter', 'crush', 'reverb', 'swirl', 'warp', 'space', 'wide'];

export const machinesOn = (fx: FxSet): FxId[] => CHAIN_ORDER.filter((id) => fx[id]);

export const fxKey = (fx: FxSet): string => machinesOn(fx).join('+');

export const chainTrimDb = (fx: FxSet, bpm: number): number =>
  machinesOn(fx).reduce((total, id) => total + machineSpec(id, bpm).trimDb, 0);
