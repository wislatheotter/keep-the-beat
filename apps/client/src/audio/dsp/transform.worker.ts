import factory from './signalsmithCore.js';
import type { StretchCore } from './signalsmithCore.js';
import { transformLoop, type TransformPlan } from './loopTransform';

export type TransformRequest = {
  id: number;
  input: ArrayBuffer[];
  inputLength: number;
  output: ArrayBuffer[];
  sampleRate: number;
  plan: TransformPlan;
};

export type TransformResponse =
  | { id: number; input: ArrayBuffer[]; output: ArrayBuffer[] }
  | { id: number; input: ArrayBuffer[]; output: ArrayBuffer[]; error: string };

let core: Promise<StretchCore> | null = null;

self.onmessage = async (event: MessageEvent<TransformRequest>) => {
  const { id, input, inputLength, output, sampleRate, plan } = event.data;
  const lent = [...input, ...output];
  try {
    const stretch = plan.mode === 'stretch' ? await (core ??= factory()) : null;
    const channels = input.map((buffer) => new Float32Array(buffer, 0, inputLength));
    const result = transformLoop(stretch, channels, sampleRate, plan);
    result.forEach((channel, c) => new Float32Array(output[c]!, 0, plan.outLength).set(channel.subarray(0, plan.outLength)));
    const reply: TransformResponse = { id, input, output };
    (self as unknown as Worker).postMessage(reply, lent);
  } catch (error) {
    const reply: TransformResponse = { id, input, output, error: error instanceof Error ? error.message : String(error) };
    (self as unknown as Worker).postMessage(reply, lent);
  }
};
