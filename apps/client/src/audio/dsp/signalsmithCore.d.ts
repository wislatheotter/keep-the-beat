export type StretchCore = {
  HEAP8: Int8Array;
  _presetDefault(channels: number, sampleRate: number): void;
  _presetCheaper(channels: number, sampleRate: number): void;
  _configure(channels: number, blockSamples: number, intervalSamples: number, splitComputation: boolean): void;
  _setBuffers(channels: number, length: number): number;
  _setTransposeSemitones(semitones: number, tonalityLimit: number): void;
  _setFormantSemitones(semitones: number, compensate: boolean): void;
  _setFormantBase(baseFreq: number): void;
  _seek(inputSamples: number, playbackRate: number): void;
  _process(inputSamples: number, outputSamples: number): void;
  _flush(outputSamples: number): void;
  _reset(): void;
  _inputLatency(): number;
  _outputLatency(): number;
  _blockSamples(): number;
  _intervalSamples(): number;
};

declare const SignalsmithStretch: (moduleArg?: object) => Promise<StretchCore>;
export default SignalsmithStretch;
