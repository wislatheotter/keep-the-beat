import {
  LAYER_LOW_CUT_HZ,
  blankFx,
  LOOP_LAYERS,
  SECTION_COUNT,
  barDurationMs,
  sample as gameSample,
  type Bands,
  type FxSet,
  type GameSample,
  type LoopLayer,
  type MixReading,
  type SongRegion,
  type SongState,
} from '@loop/shared';
import { sampleLibrary } from '../audiotool/sampleLibrary';
import { MACHINE_FX, MachineRack, createMachineRack, primeMachines } from './dsp/machineRack';
import { CUE_GAIN, makeCue, makeOpening, makePrint, OPENING_DOWNBEAT, type CueKind } from './cues';
import { FOLEY_GAIN, LAND_DOWNBEAT, makeFoley, type Foley } from './foley';
import { AimHum } from './aimHum';
import { PrintCharge } from './printCharge';
import type { SynthRequest, SynthSound } from './cueSynth.worker';

export type LayerState = {
  layer: LoopLayer;
  playing: GameSample | null;
  muted: boolean;
};

export type EngineSnapshot = {
  running: boolean;
  bpm: number;
  position: number;
  bar: number;
  beatInBar: number;
  barPhase: number;
  layers: Record<LoopLayer, LayerState>;
  limiterReductionDb: number;
};

type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  sample: GameSample;
  startsAt: number;
};

type LobbyVoice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  sampleName: string;
  bpm: number;
  gainDb: number;
  leaving: boolean;
};

type Meter = {
  analyser: AnalyserNode;
  time: Float32Array<ArrayBuffer>;
  freq: Float32Array<ArrayBuffer>;
  signature: string;
  since: number;
  lastRead: number;
  squares: number;
  frames: number;
  bands: Bands;
  limiting: number;
};

const METER_BANDS: Array<[number, number]> = [[20, 160], [160, 800], [800, 4000], [4000, 11000]];
const METER_INTERVAL = 0.09;
const METER_SETTLE = 0.15;

const RESYNC_THRESHOLD_SECONDS = 0.12;

export const PRINT_GAIN = 0.42;

type BusKey = LoopLayer | 'STINGER';
const BUSES: BusKey[] = [...LOOP_LAYERS, 'STINGER'];

export const VISUAL_BANDS = 16;

export type VisualLevels = {
  bands: Float32Array;
  levels: Record<LoopLayer, number>;
  low: number;
  loudness: number;
};

type VisualTap = {
  master: AnalyserNode;
  layers: Record<LoopLayer, AnalyserNode>;
  spectrum: Uint8Array<ArrayBuffer>;
  wave: Float32Array<ArrayBuffer>;
  out: VisualLevels;
};

export class LoopEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private cueBus: GainNode | null = null;
  private layerGains = new Map<BusKey, GainNode>();
  private fxChains = new Map<BusKey, FxChain>();
  private voices = new Map<BusKey, Voice>();
  private synth = new Map<string, AudioBuffer>();
  private charge: PrintCharge | null = null;
  private aim: AimHum | null = null;
  private landings = new Map<number, { source: AudioBufferSourceNode; gain: GainNode }>();
  private analyser: AnalyserNode | null = null;
  private looseVoices = new Set<AudioBufferSourceNode>();
  private meter: Meter | null = null;
  private visual: VisualTap | null = null;
  private lobby: LobbyVoice | null = null;

  private startTime = 0;
  private running = false;
  private bpm = 126;

  private scheduled = new Map<LoopLayer, { sampleName: string | null; atBar: number }>();

  private armed = false;

  private state = new Map<LoopLayer, LayerState>(
    LOOP_LAYERS.map((layer) => [layer, { layer, playing: null, muted: false }]),
  );
  private listeners = new Set<() => void>();

  get barSeconds() {
    return barDurationMs(this.bpm) / 1000;
  }

  get isRunning() {
    return this.running && this.context?.state === 'running';
  }

  get audible() {
    return this.context?.state === 'running';
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  prime() {
    return this.ensureContext();
  }

  async resume() {
    const context = this.ensureContext();
    if (context.state !== 'running') {
      await context.resume();
      if (this.audible) this.nudge(context);
    }
    this.emit();
  }

  private arm(context: AudioContext) {
    if (this.armed || typeof window === 'undefined') return;
    this.armed = true;
    const events = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown'] as const;
    const off = () => {
      this.armed = false;
      for (const type of events) window.removeEventListener(type, take, true);
    };
    const take = () => {
      if (context.state === 'running') { off(); return; }
      void context.resume().then(() => {
        if (context.state !== 'running') return;
        this.nudge(context);
        off();
        this.emit();
      }).catch(() => {});
    };
    for (const type of events) window.addEventListener(type, take, true);
  }

  private nudge(context: AudioContext) {
    try {
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, context.sampleRate);
      source.connect(context.destination);
      source.start();
    } catch {}
  }

  syncTransport(bpm: number, transportStartedAt: number | null, nowMs: number) {
    if (!transportStartedAt) return;
    const context = this.ensureContext();
    this.setBpm(bpm);
    const epoch = context.currentTime - (nowMs - transportStartedAt) / 1000;
    if (!this.running || Math.abs(epoch - this.startTime) > RESYNC_THRESHOLD_SECONDS) {
      this.startTime = epoch;
      this.running = true;
    }
  }

  applySong(song: SongState) {
    if (!this.running || !this.context) return;

    for (const layer of LOOP_LAYERS) {
      const active = song.layers[layer];
      const pending = song.queued.find((change) => change.layer === layer) ?? null;

      const target = pending
        ? { sampleName: pending.sampleName, atBar: pending.atBar, fx: pending.fx }
        : { sampleName: active.sampleName, atBar: active.startedAtBar, fx: active.fx };

      const already = this.scheduled.get(layer);
      if (already && already.sampleName === target.sampleName && already.atBar === target.atBar) continue;

      const atBar = Math.max(target.atBar, this.nextBar(0.02));
      this.setFx(layer, target.fx);
      const started = this.scheduleLayer(layer, target.sampleName, atBar, song.phaseBar);
      if (started) this.scheduled.set(layer, { sampleName: target.sampleName, atBar: target.atBar });
    }
  }

  fireOpening(toDownbeat: number, gainDb = -6) {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const source = context.createBufferSource();
    source.buffer = this.synthesized('opening', () => makeOpening(context));
    const gain = context.createGain();
    gain.gain.value = 10 ** (gainDb / 20);
    source.connect(gain).connect(this.layerGains.get('STINGER')!);
    const at = context.currentTime + toDownbeat - OPENING_DOWNBEAT;
    const earliest = context.currentTime + 0.01;
    if (at >= earliest) source.start(at);
    else source.start(earliest, earliest - at);
    this.looseVoices.add(source);
    source.onended = () => this.looseVoices.delete(source);
  }

  playSong(regions: SongRegion[], bpm: number, startIn = 0.25) {
    const context = this.ensureContext();
    this.stop();
    this.setBpm(bpm);
    this.startTime = context.currentTime + startIn;
    this.running = true;
    const earliest = context.currentTime + 0.03;

    let last = 0;
    for (const region of regions) {
      last = Math.max(last, region.endBar);
      const entry = gameSample(region.sampleName);
      const buffer = sampleLibrary.getBuffer(region.sampleName);
      if (!entry || !buffer) continue;

      const at = this.barTime(region.startBar);
      const until = this.barTime(region.endBar);
      if (until <= earliest) continue;

      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = 10 ** (entry.gainDb / 20);
      const bus = this.layerGains.get(region.layer)!;
      source.connect(gain).connect(bus);

      const begin = Math.max(at, earliest);
      if (entry.bars > 0) {
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = buffer.duration;
        const played = region.startBar * this.barSeconds + (begin - at);
        const offset = buffer.duration > 0 ? played % buffer.duration : 0;
        source.start(begin, offset);
        source.stop(until);
      } else if (at >= earliest) {
        source.start(at);
      } else {
        continue;
      }
      this.looseVoices.add(source);
      source.onended = () => this.looseVoices.delete(source);
      this.setFx(region.layer, region.fx, begin);
    }

    this.emit();
    return Math.max(0, this.barTime(last) - context.currentTime) * 1000;
  }

  playLobby(sample: GameSample, buffer: AudioBuffer, bpm: number): boolean {
    const context = this.ensureContext();
    if (context.state !== 'running' || !this.master) return false;
    if (this.lobby && !this.lobby.leaving && this.lobby.sampleName === sample.sampleName && this.lobby.bpm === bpm) return true;

    const now = context.currentTime;
    const at = now + 0.02;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;

    const gain = context.createGain();
    const level = 10 ** ((sample.gainDb + LOBBY_TRIM_DB) / 20);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + LOBBY_FADE);
    source.connect(gain).connect(this.master);
    source.start(at);

    this.fadeOutLobby(this.lobby, now, now + LOBBY_FADE);
    this.lobby = { source, gain, sampleName: sample.sampleName, bpm, gainDb: sample.gainDb, leaving: false };
    return true;
  }

  get lobbyRecord(): string | null {
    return this.lobby?.sampleName ?? null;
  }

  handOverLobby(sampleName: string | null) {
    const context = this.context;
    const voice = this.lobby;
    if (!context || !voice || voice.leaving || !this.running || !this.master) return;
    const end = this.barTime(0);
    const buffer = voice.source.buffer;
    const leftover = Math.max(0, end - context.currentTime);
    if (context.currentTime >= end || sampleName !== voice.sampleName || !buffer || buffer.duration <= 0) {
      this.stopLobby(leftover);
      return;
    }

    const bar = Math.ceil((context.currentTime + 0.06 - this.startTime) / this.barSeconds);
    const at = this.barTime(bar);
    if (at >= end) { this.stopLobby(leftover); return; }

    const elapsed = bar * this.barSeconds;
    const offset = ((elapsed % buffer.duration) + buffer.duration) % buffer.duration;
    const full = 10 ** (voice.gainDb / 20);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    const gain = context.createGain();
    gain.gain.setValueAtTime(voice.gain.gain.value, at);
    gain.gain.linearRampToValueAtTime(full, end);
    source.connect(gain).connect(this.master);
    source.start(at, offset);
    source.stop(end);

    const going = voice.gain.gain;
    const held = going.value;
    going.cancelScheduledValues(context.currentTime);
    going.setValueAtTime(held, context.currentTime);
    going.setValueAtTime(held, at);
    going.linearRampToValueAtTime(0.0001, at + 0.008);
    try { voice.source.stop(at + 0.03); } catch {}

    this.lobby = { source, gain, sampleName: voice.sampleName, bpm: voice.bpm, gainDb: voice.gainDb, leaving: true };
    source.onended = () => { if (this.lobby?.source === source) this.lobby = null; };
  }

  stopLobby(inSeconds = LOBBY_FADE) {
    const context = this.context;
    if (!context || !this.lobby) return;
    const now = context.currentTime;
    const end = now + Math.max(0, inSeconds);
    this.lobby.leaving = true;
    this.fadeOutLobby(this.lobby, Math.max(now, end - LOBBY_FADE), end);
  }

  private fadeOutLobby(voice: LobbyVoice | null, from: number, until: number) {
    const context = this.context;
    if (!voice || !context) return;
    voice.leaving = true;
    voice.source.onended = () => { if (this.lobby === voice) this.lobby = null; };
    const gain = voice.gain.gain;
    const held = gain.value;
    gain.cancelScheduledValues(context.currentTime);
    gain.setValueAtTime(held, context.currentTime);
    gain.setValueAtTime(held, from);
    gain.linearRampToValueAtTime(0.0001, until);
    try { voice.source.stop(until + 0.05); } catch {}
  }

  windDown(seconds = 1.5) {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    for (const voice of this.voices.values()) {
      const rate = voice.source.playbackRate;
      rate.cancelScheduledValues(now);
      rate.setValueAtTime(rate.value, now);
      rate.exponentialRampToValueAtTime(0.05, now + seconds);
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0.0001, now + seconds);
      try { voice.source.stop(now + seconds + 0.02); } catch {}
    }
    this.voices.clear();
    this.scheduled.clear();
    for (const state of this.state.values()) state.playing = null;
    this.running = false;
    this.emit();
  }


  stop() {
    this.releaseCharge(0.01);
    this.aimThrow(null);
    for (const landing of this.landings.values()) {
      try { landing.source.stop(); } catch {}
    }
    this.landings.clear();
    for (const bus of BUSES) this.stopVoice(bus, 0);
    this.voices.clear();
    for (const source of this.looseVoices) {
      try { source.stop(); } catch {}
    }
    this.looseVoices.clear();
    this.scheduled.clear();
    const now = this.context?.currentTime ?? 0;
    for (const bus of BUSES) {
      this.fxChains.get(bus)?.cancelFrom(now);
      this.setFx(bus, blankFx(), now);
    }
    for (const state of this.state.values()) {
      state.playing = null;
    }
    this.running = false;
    this.emit();
  }

  private ensureContext() {
    if (!this.context) {
      const context = new AudioContext({ latencyHint: 'interactive' });
      this.context = context;
      sampleLibrary.attachContext(context);
      this.arm(context);
      context.addEventListener('statechange', () => {
        if (context.state !== 'running') this.arm(context);
        this.emit();
      });

      const master = context.createGain();
      master.gain.value = MASTER_GAIN;

      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;

      master.connect(limiter).connect(context.destination);
      this.master = master;
      this.limiter = limiter;

      const cueBus = context.createGain();
      cueBus.gain.value = 1;
      cueBus.connect(limiter);
      this.cueBus = cueBus;

      for (const bus of BUSES) {
        const chain = new FxChain(context, master, bus === 'STINGER' ? 0 : LAYER_LOW_CUT_HZ[bus], this.bpm);
        this.fxChains.set(bus, chain);
        this.layerGains.set(bus, chain.input);
      }
      void primeMachines(context);
      this.synthesize(context);
    }
    return this.context;
  }

  private setBpm(bpm: number) {
    if (this.bpm === bpm) return;
    this.bpm = bpm;
    for (const chain of this.fxChains.values()) chain.setTempo(bpm);
  }

  private nextBar(lead = 0.06) {
    const context = this.context;
    if (!context) return 0;
    const elapsed = context.currentTime + lead - this.startTime;
    return Math.max(0, Math.ceil(elapsed / this.barSeconds));
  }

  private barTime(bar: number) {
    return this.startTime + bar * this.barSeconds;
  }

  snapshot(): EngineSnapshot {
    const context = this.context;
    const elapsed = context && this.running ? context.currentTime - this.startTime : 0;
    const position = Math.max(0, elapsed) / this.barSeconds;
    const layers = Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, { ...this.state.get(layer)! }])) as Record<LoopLayer, LayerState>;
    return {
      running: this.running,
      bpm: this.bpm,
      position,
      bar: Math.floor(position),
      beatInBar: Math.floor((position % 1) * 4),
      barPhase: position % 1,
      layers,
      limiterReductionDb: this.limiter ? Math.abs(this.limiter.reduction) : 0,
    };
  }

  toggleMute(layer: LoopLayer) {
    const state = this.state.get(layer)!;
    state.muted = !state.muted;
    const chain = this.fxChains.get(layer);
    if (chain && this.context) chain.setMute(state.muted, this.context.currentTime);
    this.emit();
  }

  measure(): { rms: number; centroidHz: number; bands: number[] } | null {
    const context = this.context;
    if (!context || !this.limiter) return null;
    if (!this.analyser) {
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      this.limiter.connect(this.analyser);
    }
    const bins = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(bins);
    const hzPerBin = context.sampleRate / this.analyser.fftSize;
    let total = 0;
    let weighted = 0;
    const bands = [0, 0, 0, 0];
    for (let index = 1; index < bins.length; index += 1) {
      const power = 10 ** (bins[index]! / 10);
      const hz = index * hzPerBin;
      total += power;
      weighted += power * hz;
      const band = hz < 160 ? 0 : hz < 800 ? 1 : hz < 4000 ? 2 : 3;
      bands[band] += power;
    }
    return {
      rms: total,
      centroidHz: total > 0 ? weighted / total : 0,
      bands: bands.map((value) => (total > 0 ? value / total : 0)),
    };
  }

  visualLevels(): VisualLevels | null {
    const context = this.context;
    if (!context || !this.limiter || context.state !== 'running' || !this.running) return null;
    if (!this.visual) {
      const master = context.createAnalyser();
      master.fftSize = 1024;
      master.smoothingTimeConstant = 0.72;
      master.minDecibels = -78;
      master.maxDecibels = -18;
      this.limiter.connect(master);
      const layers = {} as Record<LoopLayer, AnalyserNode>;
      for (const layer of LOOP_LAYERS) {
        const tap = context.createAnalyser();
        tap.fftSize = 256;
        tap.smoothingTimeConstant = 0;
        this.fxChains.get(layer)?.output.connect(tap);
        layers[layer] = tap;
      }
      this.visual = {
        master,
        layers,
        spectrum: new Uint8Array(master.frequencyBinCount),
        wave: new Float32Array(256),
        out: { bands: new Float32Array(VISUAL_BANDS), levels: { DRUMS: 0, BASS: 0, MUSIC: 0, TOPS: 0 }, low: 0, loudness: 0 },
      };
    }
    const tap = this.visual;
    const out = tap.out;
    tap.master.getByteFrequencyData(tap.spectrum);
    const hzPerBin = context.sampleRate / tap.master.fftSize;
    let total = 0;
    for (let band = 0; band < VISUAL_BANDS; band += 1) {
      const lo = 40 * (14000 / 40) ** (band / VISUAL_BANDS);
      const hi = 40 * (14000 / 40) ** ((band + 1) / VISUAL_BANDS);
      const from = Math.max(1, Math.floor(lo / hzPerBin));
      const to = Math.max(from + 1, Math.ceil(hi / hzPerBin));
      let peak = 0;
      for (let bin = from; bin < to && bin < tap.spectrum.length; bin += 1) peak = Math.max(peak, tap.spectrum[bin]!);
      out.bands[band] = peak / 255;
      total += out.bands[band]!;
    }
    out.low = (out.bands[0]! + out.bands[1]! + out.bands[2]!) / 3;
    out.loudness = total / VISUAL_BANDS;
    for (const layer of LOOP_LAYERS) {
      tap.layers[layer].getFloatTimeDomainData(tap.wave);
      let squares = 0;
      for (let i = 0; i < tap.wave.length; i += 1) squares += tap.wave[i]! * tap.wave[i]!;
      const db = 10 * Math.log10(squares / tap.wave.length + 1e-12);
      const level = Math.max(0, Math.min(1, (db + 42) / 36));
      const was = out.levels[layer];
      out.levels[layer] = level > was ? level : was + (level - was) * 0.18;
    }
    return out;
  }

  meterMix(signature: string) {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running' || !this.running) return;
    if (!this.meter) {
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      this.master.connect(analyser);
      this.meter = {
        analyser,
        time: new Float32Array(analyser.fftSize),
        freq: new Float32Array(analyser.frequencyBinCount),
        signature: '', since: 0, lastRead: 0, squares: 0, frames: 0, bands: [0, 0, 0, 0], limiting: 0,
      };
    }
    const meter = this.meter;
    const now = context.currentTime;
    if (signature !== meter.signature) {
      meter.signature = signature;
      meter.since = now;
      meter.squares = 0;
      meter.frames = 0;
      meter.bands = [0, 0, 0, 0];
      meter.limiting = 0;
      return;
    }
    if (now - meter.since < METER_SETTLE || now - meter.lastRead < METER_INTERVAL) return;
    meter.lastRead = now;

    meter.analyser.getFloatTimeDomainData(meter.time);
    let squares = 0;
    for (let i = 0; i < meter.time.length; i += 1) squares += meter.time[i]! * meter.time[i]!;
    meter.squares += squares / meter.time.length;

    meter.analyser.getFloatFrequencyData(meter.freq);
    const hzPerBin = context.sampleRate / meter.analyser.fftSize;
    for (let i = 1; i < meter.freq.length; i += 1) {
      const hz = i * hzPerBin;
      const band = METER_BANDS.findIndex(([low, high]) => hz >= low && hz < high);
      if (band >= 0) meter.bands[band] += 10 ** (meter.freq[i]! / 10);
    }
    meter.limiting += this.limiter ? Math.abs(this.limiter.reduction) : 0;
    meter.frames += 1;
  }

  mixReading(signature: string, minSeconds: number): (MixReading & { signature: string }) | null {
    const meter = this.meter;
    const context = this.context;
    if (!meter || !context || meter.signature !== signature || meter.frames < 6) return null;
    if (context.currentTime - meter.since < minSeconds) return null;
    const meanSquare = meter.squares / meter.frames;
    if (meanSquare <= 1e-9) return null;
    const total = meter.bands.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return null;
    return {
      loudnessDb: 10 * Math.log10(meanSquare) - 20 * Math.log10(MASTER_GAIN),
      shares: meter.bands.map((value) => value / total) as Bands,
      limitingDb: meter.limiting / meter.frames,
      source: 'measured',
      signature,
    };
  }

  machines(): Record<string, Record<string, number> | null> {
    return Object.fromEntries([...this.fxChains].map(([bus, chain]) => [bus, chain.machineState()]));
  }

  blip(kind: CueKind) {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.cueBus) return;
    const buffer = this.synthesized(`cue:${kind}`, () => makeCue(context, kind));
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = CUE_GAIN[kind];
    source.connect(gain).connect(this.cueBus);
    source.start(context.currentTime + 0.005);
  }

  chargePrint(progress: number) {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.cueBus) {
      this.releaseCharge(0.01);
      return;
    }
    if (progress <= 0) {
      this.releaseCharge(0.08);
      return;
    }
    this.charge ??= new PrintCharge(context, this.cueBus, context.currentTime);
    this.charge.update(progress, context.currentTime);
  }

  foley(kind: Foley, level = 1) {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.cueBus) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = this.synthesized(`foley:${kind}`, () => makeFoley(context, kind));
    gain.gain.value = FOLEY_GAIN[kind] * level;
    source.connect(gain).connect(this.cueBus);
    source.start(context.currentTime + 0.005);
  }

  aimThrow(power: number | null) {
    const context = this.context;
    if (power === null || !context || context.state !== 'running' || !this.cueBus) {
      if (this.aim && context) this.aim.release(context.currentTime);
      this.aim = null;
      return;
    }
    this.aim ??= new AimHum(context, this.cueBus, context.currentTime);
    this.aim.update(power, context.currentTime);
  }

  landOn(bars: number[]) {
    const context = this.context;
    const output = this.cueBus;
    if (!context || context.state !== 'running' || !output || !this.running) return;
    const now = context.currentTime;
    for (const [bar, landing] of this.landings) {
      const at = this.barTime(bar);
      if (at < now - 2) this.landings.delete(bar);
      else if (!bars.includes(bar) && at > now + 0.2) {
        landing.gain.gain.setTargetAtTime(0, now, 0.03);
        landing.source.stop(now + 0.2);
        this.landings.delete(bar);
      }
    }
    for (const bar of bars) {
      if (this.landings.has(bar)) continue;
      const at = this.barTime(bar);
      if (at < now + 0.02) continue;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = this.synthesized('foley:land', () => makeFoley(context, 'land'));
      gain.gain.value = FOLEY_GAIN.land;
      source.connect(gain).connect(output);
      const start = at - LAND_DOWNBEAT;
      const earliest = now + 0.01;
      if (start >= earliest) source.start(start);
      else source.start(earliest, earliest - start);
      this.landings.set(bar, { source, gain });
    }
  }

  printed(index: number) {
    this.releaseCharge(0.004);
    const context = this.context;
    if (!context || context.state !== 'running' || !this.cueBus) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = this.synthesized(`print:${index}`, () => makePrint(context, index));
    gain.gain.value = PRINT_GAIN;
    source.connect(gain).connect(this.cueBus);
    source.start(context.currentTime + 0.005);
  }

  private synthesize(context: AudioContext) {
    const worker = new Worker(new URL('./cueSynth.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<SynthSound>) => {
      const { key, channels } = event.data;
      if (this.context !== context || this.synth.has(key)) return;
      const buffer = context.createBuffer(channels.length, channels[0]!.length, context.sampleRate);
      channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
      this.synth.set(key, buffer);
    };
    worker.postMessage({ sampleRate: context.sampleRate, prints: SECTION_COUNT } satisfies SynthRequest);
  }

  private synthesized(key: string, make: () => AudioBuffer) {
    let buffer = this.synth.get(key);
    if (!buffer) {
      buffer = make();
      this.synth.set(key, buffer);
    }
    return buffer;
  }

  private releaseCharge(fade: number) {
    if (this.charge && this.context) this.charge.release(fade, this.context.currentTime);
    this.charge = null;
  }

  private setFx(bus: BusKey, fx: FxSet, at?: number) {
    const context = this.context;
    const chain = this.fxChains.get(bus);
    if (!context || !chain) return;
    chain.set(fx, at ?? context.currentTime);
  }

  private scheduleLayer(layer: LoopLayer, sampleName: string | null, atBar: number, phaseBar: number): boolean {
    const context = this.context;
    if (!context) return false;
    const at = Math.max(this.barTime(atBar), context.currentTime + 0.01);

    this.stopVoice(layer, at);
    const state = this.state.get(layer)!;

    if (!sampleName) {
      state.playing = null;
      this.emit();
      return true;
    }

    const entry = gameSample(sampleName);
    const buffer = sampleLibrary.getBuffer(sampleName);
    if (!entry || !buffer) {
      state.playing = null;
      this.emit();
      return false;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;

    const gain = context.createGain();
    gain.gain.value = 10 ** (entry.gainDb / 20);
    source.connect(gain).connect(this.layerGains.get(layer)!);

    const elapsed = at - this.barTime(phaseBar);
    const offset = buffer.duration > 0 ? ((elapsed % buffer.duration) + buffer.duration) % buffer.duration : 0;
    source.start(at, offset);

    this.voices.set(layer, { source, gain, sample: entry, startsAt: at });
    state.playing = entry;
    this.emit();
    return true;
  }

  private stopVoice(bus: BusKey, at: number) {
    const voice = this.voices.get(bus);
    if (!voice) return;
    const context = this.context!;
    const stopAt = voice.startsAt > context.currentTime ? context.currentTime : Math.max(at, context.currentTime);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, Math.max(context.currentTime, stopAt - 0.006));
    voice.gain.gain.linearRampToValueAtTime(0.0001, stopAt);
    try { voice.source.stop(stopAt + 0.01); } catch {}
    this.voices.delete(bus);
  }

  dispose() {
    this.stop();
    this.stopLobby(0);
    this.meter = null;
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.limiter = null;
    this.cueBus = null;
    this.synth.clear();
    this.analyser = null;
    this.visual = null;
    this.layerGains.clear();
    for (const chain of this.fxChains.values()) chain.dispose();
    this.fxChains.clear();
    this.listeners.clear();
  }
}

class FxChain {
  readonly input: GainNode;
  get output(): AudioNode { return this.mute; }
  private context: AudioContext;
  private tone: BiquadFilterNode;
  private toneTrim: GainNode;
  private dry: GainNode;
  private echoSend: GainNode;
  private crushSend: GainNode;
  private blend: GainNode;
  private mute: GainNode;
  private rack: MachineRack | null = null;
  private rackAsked = false;
  private bpm: number;
  private automated: AudioParam[] = [];
  private queued: Array<{ at: number; fx: FxSet }> = [];

  constructor(context: AudioContext, destination: AudioNode, lowCutHz = 0, bpm = 120) {
    this.context = context;
    this.bpm = bpm;
    this.input = context.createGain();
    this.mute = context.createGain();
    this.mute.connect(destination);
    this.blend = context.createGain();
    this.blend.connect(this.mute);

    let head: AudioNode = this.input;
    if (lowCutHz > 0) {
      for (const q of BUTTERWORTH4_Q) {
        const stage = context.createBiquadFilter();
        stage.type = 'highpass';
        stage.frequency.value = lowCutHz;
        stage.Q.value = q;
        head = head.connect(stage);
      }
    }

    this.tone = context.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = OPEN_HZ;
    this.tone.Q.value = 0.0001;
    this.toneTrim = context.createGain();
    this.toneTrim.gain.value = 1;
    head.connect(this.tone).connect(this.toneTrim);

    this.dry = context.createGain();
    this.dry.gain.value = 1;
    this.toneTrim.connect(this.dry).connect(this.blend);

    this.echoSend = context.createGain();
    this.echoSend.gain.value = 0;
    const delay = context.createDelay(1.5);
    delay.delayTime.value = 0.26;
    const feedback = context.createGain();
    feedback.gain.value = 0.42;
    const damp = context.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    this.toneTrim.connect(this.echoSend).connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    damp.connect(this.blend);

    this.crushSend = context.createGain();
    this.crushSend.gain.value = 0;
    const drive = context.createGain();
    drive.gain.value = 6;
    const shaper = context.createWaveShaper();
    shaper.curve = crushCurve();
    shaper.oversample = '2x';
    const tame = context.createBiquadFilter();
    tame.type = 'highshelf';
    tame.frequency.value = 3600;
    tame.gain.value = -9;
    const trim = context.createGain();
    trim.gain.value = CRUNCH_TRIM;
    this.toneTrim.connect(this.crushSend).connect(drive).connect(shaper).connect(tame).connect(trim).connect(this.blend);

    this.automated = [
      this.tone.frequency, this.tone.Q, this.toneTrim.gain,
      this.dry.gain, this.echoSend.gain, this.crushSend.gain,
    ];
  }

  set(fx: FxSet, at: number) {
    const ramp = RAMP;
    this.tone.frequency.setTargetAtTime(fx.filter ? SHADE_HZ : OPEN_HZ, at, ramp);
    this.tone.Q.setTargetAtTime(fx.filter ? 1.6 : 0.0001, at, ramp);
    this.toneTrim.gain.setTargetAtTime(fx.filter ? 1.45 : 1, at, ramp);
    this.dry.gain.setTargetAtTime(fx.crush ? 0.35 : 1, at, ramp);
    this.echoSend.gain.setTargetAtTime(fx.reverb ? 0.55 : 0, at, ramp);
    this.crushSend.gain.setTargetAtTime(fx.crush ? 1 : 0, at, ramp);

    if (this.rack) this.rack.set(fx, at, ramp);
    else if (this.rackAsked) this.queued.push({ at, fx: { ...fx } });
    else if (MACHINE_FX.some((id) => fx[id])) {
      this.queued.push({ at, fx: { ...fx } });
      this.askForRack();
    }
  }

  cancelFrom(at: number) {
    for (const param of this.automated) param.cancelScheduledValues(at);
    this.rack?.cancel(at);
    this.queued = this.queued.filter((entry) => entry.at < at);
  }

  setTempo(bpm: number) {
    this.bpm = bpm;
    this.rack?.setTempo(bpm);
  }

  private askForRack() {
    if (this.rackAsked) return;
    this.rackAsked = true;
    void createMachineRack(this.context, this.bpm).then((rack) => {
      if (!rack) return;
      this.rack = rack;
      this.blend.disconnect(this.mute);
      this.blend.connect(rack.node).connect(this.mute);

      const now = this.context.currentTime;
      let due: FxSet | null = null;
      for (const entry of this.queued) if (entry.at <= now) due = entry.fx;
      if (due) rack.set(due, now, RAMP);
      for (const entry of this.queued) if (entry.at > now) rack.set(entry.fx, entry.at, RAMP);
      this.queued = [];
    });
  }

  machineState(): Record<string, number> | null {
    if (!this.rack) return null;
    return Object.fromEntries(MACHINE_FX.map((id) => [id, this.rack!.node.parameters.get(id)?.value ?? 0]));
  }

  setMute(muted: boolean, at: number) {
    this.mute.gain.setTargetAtTime(muted ? 0 : 1, at, 0.01);
  }

  dispose() {
    this.rack?.dispose();
    this.rack = null;
  }
}

const RAMP = 0.04;

const MASTER_GAIN = 0.9;

const LOBBY_TRIM_DB = -3;
const LOBBY_FADE = 0.55;

const CRUNCH_TRIM = 0.17;

const BUTTERWORTH4_Q = [0.5412, 1.3066];

const OPEN_HZ = 19_000;
const SHADE_HZ = 620;

function crushCurve() {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2) * 0.85;
  }
  return curve;
}

export const loopEngine = new LoopEngine();
export type { CueKind };
