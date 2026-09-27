import { type FxId, type FxSet } from '@loop/shared';
import rackModuleUrl from './machines.worklet?worker&url';

export const MACHINE_FX = ['space', 'wide', 'swirl', 'warp'] as const;
export type MachineFx = typeof MACHINE_FX[number];

export const isMachineFx = (fx: FxId): fx is MachineFx =>
  (MACHINE_FX as readonly FxId[]).includes(fx);

const PROCESSOR = 'machine-rack';

export const warpDelaySeconds = (bpm: number) => 45 / Math.max(20, bpm);

const modules = new WeakMap<BaseAudioContext, Promise<boolean>>();

export function primeMachines(context: BaseAudioContext): Promise<boolean> {
  const existing = modules.get(context);
  if (existing) return existing;
  const loading = context.audioWorklet
    ? context.audioWorklet.addModule(rackModuleUrl).then(() => true, (error: unknown) => {
      console.warn('[audio] the machine rack failed to load; SPACE, WIDE, SWIRL and WARP will be silent', error);
      return false;
    })
    : Promise.resolve(false);
  modules.set(context, loading);
  return loading;
}

export class MachineRack {
  readonly node: AudioWorkletNode;

  constructor(context: BaseAudioContext, bpm: number) {
    this.node = new AudioWorkletNode(context, PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.setTempo(bpm);
  }

  set(fx: FxSet, at: number, ramp: number) {
    for (const id of MACHINE_FX) {
      this.node.parameters.get(id)?.setTargetAtTime(fx[id] ? 1 : 0, at, ramp);
    }
  }

  cancel(at: number) {
    for (const id of MACHINE_FX) this.node.parameters.get(id)?.cancelScheduledValues(at);
  }

  setTempo(bpm: number) {
    const param = this.node.parameters.get('warpDelay');
    if (param) param.value = warpDelaySeconds(bpm);
  }

  dispose() {
    this.node.disconnect();
  }
}

export async function createMachineRack(context: BaseAudioContext, bpm: number): Promise<MachineRack | null> {
  if (!(await primeMachines(context))) return null;
  try {
    return new MachineRack(context, bpm);
  } catch (error) {
    console.warn('[audio] the machine rack could not be built', error);
    return null;
  }
}
