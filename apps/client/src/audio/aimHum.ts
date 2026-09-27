import { makeNoise, PRINT_ROOT } from './cues';

const AIM_GAIN = 0.045;

let noise: AudioBuffer | null = null;

export class AimHum {
  private source: AudioBufferSourceNode;
  private tones: OscillatorNode[] = [];
  private breath: OscillatorNode;
  private air: BiquadFilterNode;
  private gain: GainNode;

  constructor(context: BaseAudioContext, output: AudioNode, at: number) {
    noise ??= makeNoise(context);
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(output);
    const swell = context.createGain();
    swell.gain.value = 0.82;
    swell.connect(this.gain);
    this.breath = context.createOscillator();
    this.breath.frequency.value = 2.5;
    const depth = context.createGain();
    depth.gain.value = 0.18;
    this.breath.connect(depth).connect(swell.gain);
    this.breath.start(at);

    this.source = context.createBufferSource();
    this.source.buffer = noise;
    this.source.loop = true;
    this.air = context.createBiquadFilter();
    this.air.type = 'bandpass';
    this.air.Q.value = 0.9;
    this.air.frequency.value = 1400;
    const airLevel = context.createGain();
    airLevel.gain.value = 0.55;
    this.source.connect(this.air).connect(airLevel).connect(swell);
    this.source.start(at);

    const soft = context.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 900;
    soft.connect(swell);
    for (const multiple of [1, 1.5]) {
      const osc = context.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = (PRINT_ROOT / 4) * multiple;
      const level = context.createGain();
      level.gain.value = 0.22;
      osc.connect(level).connect(soft);
      osc.start(at);
      this.tones.push(osc);
    }
    this.gain.gain.setTargetAtTime(AIM_GAIN, at, 0.12);
  }

  update(power: number, at: number) {
    this.air.frequency.setTargetAtTime(1100 + 1800 * Math.min(1, Math.max(0, power)), at, 0.08);
  }

  release(at: number) {
    this.gain.gain.cancelScheduledValues(at);
    this.gain.gain.setTargetAtTime(0, at, 0.05);
    const end = at + 0.4;
    for (const osc of this.tones) osc.stop(end);
    this.breath.stop(end);
    this.source.stop(end);
    this.source.onended = () => this.gain.disconnect();
  }
}
