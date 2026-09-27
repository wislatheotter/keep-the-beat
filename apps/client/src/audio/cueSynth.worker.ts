import { makeOpening, makePrint } from './cues';
import { FOLEY, makeFoley } from './foley';

export type SynthRequest = { sampleRate: number; prints: number };
export type SynthSound = { key: string; channels: Float32Array[] };

self.onmessage = (event: MessageEvent<SynthRequest>) => {
  const { sampleRate, prints } = event.data;
  const context = {
    sampleRate,
    createBuffer: (count: number, length: number, rate: number) => {
      const channels = Array.from({ length: count }, () => new Float32Array(length));
      return { numberOfChannels: count, length, sampleRate: rate, getChannelData: (index: number) => channels[index]! };
    },
  } as unknown as BaseAudioContext;
  const send = (key: string, buffer: AudioBuffer) => {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    self.postMessage({ key, channels } satisfies SynthSound, channels.map((channel) => channel.buffer as ArrayBuffer));
  };
  send('opening', makeOpening(context));
  for (let index = 0; index < prints; index += 1) send(`print:${index}`, makePrint(context, index));
  for (const kind of FOLEY) send(`foley:${kind}`, makeFoley(context, kind));
  self.close();
};
