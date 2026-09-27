import type { StretchCore } from './signalsmithCore.js';

export type TransformMode = 'resample' | 'stretch';

export type TransformPlan = {
  mode: TransformMode;
  outLength: number;
  semitones: number;
};

const TONALITY_HZ = 8000;
const CHUNK = 2048;

export function transformLoop(
  core: StretchCore | null,
  input: Float32Array[],
  sampleRate: number,
  plan: TransformPlan,
): Float32Array[] {
  if (plan.mode === 'resample' || !core) return input.map((channel) => resample(channel, plan.outLength));
  const factor = 2 ** (plan.semitones / 12);
  const shifted = factor === 1 ? input : input.map((channel) => resample(channel, Math.max(2, Math.round(channel.length / factor))));
  return stretch(core, shifted, sampleRate, plan.outLength, 0);
}

export function resample(input: Float32Array, outLength: number): Float32Array {
  if (outLength <= 0) return new Float32Array(0);
  const n = input.length;
  if (outLength === n) return input.slice();
  const output = new Float32Array(outLength);
  const scale = n / outLength;
  const at = (i: number) => input[((i % n) + n) % n]!;
  for (let i = 0; i < outLength; i += 1) {
    const position = i * scale;
    const k = Math.floor(position);
    const t = position - k;
    const y0 = at(k - 1);
    const y1 = at(k);
    const y2 = at(k + 1);
    const y3 = at(k + 2);
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    output[i] = ((c3 * t + c2) * t + c1) * t + y1;
  }
  return output;
}

function stretch(core: StretchCore, input: Float32Array[], sampleRate: number, outLength: number, semitones: number): Float32Array[] {
  const channels = input.length;
  const n = input[0]!.length;
  const m = outLength;
  const rate = n / m;

  core._presetDefault(channels, sampleRate);
  core._setTransposeSemitones(semitones, TONALITY_HZ / sampleRate);
  const inputLatency = core._inputLatency();
  const outputLatency = core._outputLatency();
  const preroll = core._blockSamples() + core._intervalSamples() + inputLatency;
  const maxIn = Math.ceil(CHUNK * rate) + 4;
  const length = Math.max(maxIn, CHUNK, preroll);
  const pointer = core._setBuffers(channels, length);
  const inAt = (c: number) => (pointer >> 2) + length * c;
  const outAt = (c: number) => (pointer >> 2) + length * (channels + c);
  const heap = () => new Float32Array(core.HEAP8.buffer);

  const feed = (from: number, count: number) => {
    const memory = heap();
    for (let c = 0; c < channels; c += 1) {
      const source = input[c]!;
      const base = inAt(c);
      let at = ((from % n) + n) % n;
      for (let i = 0; i < count; i += 1) {
        memory[base + i] = source[at]!;
        at += 1;
        if (at === n) at = 0;
      }
    }
  };

  const seam = Math.min(Math.round(SEAM_SECONDS * sampleRate), Math.floor(m / 4));
  const origin = -seam;

  const startIn = Math.round(origin * rate);
  feed(startIn + inputLatency - preroll, preroll);
  core._seek(preroll, rate);

  const rendered = input.map(() => new Float32Array(m + seam));
  const total = m + seam + outputLatency;
  let produced = 0;
  while (produced < total) {
    const count = Math.min(CHUNK, total - produced);
    const from = Math.round((origin + produced) * rate);
    const to = Math.round((origin + produced + count) * rate);
    feed(inputLatency + from, to - from);
    core._process(to - from, count);
    const memory = heap();
    for (let c = 0; c < channels; c += 1) {
      const base = outAt(c);
      const target = rendered[c]!;
      for (let i = 0; i < count; i += 1) {
        const at = produced + i - outputLatency;
        if (at >= 0 && at < m + seam) target[at] = memory[base + i]!;
      }
    }
    produced += count;
  }

  return rendered.map((full) => {
    const out = full.slice(seam, seam + m);
    for (let i = 0; i < seam; i += 1) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / seam);
      const at = m - seam + i;
      out[at] = out[at]! * (1 - w) + full[i]! * w;
    }
    return out;
  });
}

const SEAM_SECONDS = 0.04;
