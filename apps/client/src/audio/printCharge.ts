import { makeNoise, PRINT_ROOT } from './cues';

const CHARGE_GAIN = 0.2;

let noise: AudioBuffer | null = null;

export class PrintCharge {
  private tones: Array<{ osc: OscillatorNode; multiple: number }> = [];
  private source: AudioBufferSourceNode;
  private filter: BiquadFilterNode;
  private hiss: BiquadFilterNode;
  private gain: GainNode;
  private pitch = PRINT_ROOT / 4;

  constructor(context: BaseAudioContext, output: AudioNode, at: number) {
    noise ??= makeNoise(context);
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(output);
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 7;
    this.filter.frequency.value = 350;
    this.filter.connect(this.gain);
    for (const [type, multiple, cents, level] of [
      ['sawtooth', 1, -7, 0.35], ['sawtooth', 1, 7, 0.35], ['sine', 0.5, 0, 0.6],
    ] as const) {
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.value = this.pitch * multiple;
      osc.detune.value = cents;
      const amp = context.createGain();
      amp.gain.value = level;
      osc.connect(amp).connect(this.filter);
      osc.start(at);
      this.tones.push({ osc, multiple });
    }
    this.source = context.createBufferSource();
    this.source.buffer = noise;
    this.source.loop = true;
    this.hiss = context.createBiquadFilter();
    this.hiss.type = 'bandpass';
    this.hiss.Q.value = 1.4;
    this.hiss.frequency.value = 900;
    const hissLevel = context.createGain();
    hissLevel.gain.value = 0.5;
    this.source.connect(this.hiss).connect(hissLevel).connect(this.gain);
    this.source.start(at);
  }

  update(progress: number, at: number) {
    const p = Math.min(1, Math.max(0, progress));
    this.pitch = (PRINT_ROOT / 4) * 4 ** p;
    for (const { osc, multiple } of this.tones) osc.frequency.setTargetAtTime(this.pitch * multiple, at, 0.03);
    this.filter.frequency.setTargetAtTime(350 * 16 ** p, at, 0.03);
    this.hiss.frequency.setTargetAtTime(900 * 8 ** p, at, 0.03);
    this.gain.gain.setTargetAtTime(CHARGE_GAIN * (0.45 + 0.55 * p * p), at, 0.03);
  }

  release(fade: number, at: number) {
    this.gain.gain.cancelScheduledValues(at);
    this.gain.gain.setTargetAtTime(0, at, fade);
    for (const { osc, multiple } of this.tones) {
      osc.frequency.cancelScheduledValues(at);
      osc.frequency.setTargetAtTime(this.pitch * multiple * 0.75, at, fade * 2);
    }
    this.filter.frequency.cancelScheduledValues(at);
    this.filter.frequency.setTargetAtTime(300, at, fade * 2);
    const end = at + fade * 8 + 0.02;
    for (const { osc } of this.tones) osc.stop(end);
    this.source.stop(end);
    this.source.onended = () => this.gain.disconnect();
  }
}
