import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, Color, MeshStandardMaterial, ShaderMaterial, Vector2, type Group } from 'three';
import { ARENA_RADIUS, DECK_POSITION, DECK_PLINTH_RADIUS, LAYER_COLORS, LOOP_LAYERS, PLATTER_BEARING, STATION_BY_ID, replayClock, theme, stationPosition, type GameState, type LoopLayer } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { PERFORMANCE } from '../performance';
import { beatInfo, showEnergy, type BeatInfo } from '../beat';
import { audioFrame, type AudioFrame } from '../audioMeter';
import { finaleCut, finaleRise } from '../stage';
import { rigTime, useSweeps, sweepPosition } from './ClubLights';
import { discoLight } from './DiscoBall';
import { platterMoment } from '../replayDeck';

const MAX_SIGNALS = 4;
const MAX_SWEEPS = 4;
const FLOOR_RADIUS = ARENA_RADIUS - 0.2;
const REPLAY_FLOOR_SCALE = 1.55;

const BARS = 16;
const METER_INNER = DECK_PLINTH_RADIUS + 0.55;
const METER_REACH = 5.6;
const QUARTER_LAYERS: LoopLayer[] = [0, 1, 2, 3].map(
  (quarter) => LOOP_LAYERS.find((layer) => Math.floor(PLATTER_BEARING[layer] * 4) === quarter)!,
);

const worldVertex = `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const tileFragment = `
  uniform float uTime;
  uniform float uBeat;
  uniform float uEnergy;
  uniform vec3 uAccent;
  uniform vec3 uCool;
  uniform vec3 uPale;
  uniform float uSweepCount;
  uniform vec2 uSweeps[${MAX_SWEEPS}];
  uniform vec3 uSweepColors[${MAX_SWEEPS}];
  uniform float uSweepGain;
  uniform float uRadius;
  uniform float uTile;
  uniform float uLitGain;
  uniform float uReplay;
  uniform float uMeter;
  uniform vec2 uMeterBars[${BARS * 4}];
  uniform vec3 uMeterColors[4];
  uniform float uKick;
  uniform float uKickAt;
  uniform vec3 uBall;
  uniform float uBallSpin;
  uniform float uBallGain;
  uniform vec3 uBallColors[4];
  varying vec3 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec2 p = vWorld.xz / uTile;
    vec2 cell = floor(p);
    vec2 f = fract(p);

    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float grout = 1.0 - smoothstep(0.0, 0.045, edge);
    float face = smoothstep(0.025, 0.09, edge);

    float rnd = hash(cell);
    float beatIndex = floor(uBeat);
    float beatPhase = fract(uBeat);

    float litFraction = clamp(1.0 - (1.0 - mix(0.95, 0.80, uEnergy)) * uLitGain, 0.5, 0.99);
    float lit = step(litFraction, fract(rnd * 7.13 + beatIndex * 0.3183));
    float previous = step(litFraction, fract(rnd * 7.13 + (beatIndex - 1.0) * 0.3183));
    float decay = pow(1.0 - beatPhase, 1.5);
    float peak = 0.10 + uEnergy * 0.34;
    float energy = lit * (0.012 + decay * peak) + previous * (1.0 - decay) * 0.03;

    float radius = length(vWorld.xz);
    float swell = 0.5 + 0.5 * sin(radius * 0.3 - uTime * 1.25);
    energy += swell * (0.003 + uEnergy * 0.006) + 0.0015;

    float pick = hash(cell + 17.3);
    vec3 tint = pick < 0.4 ? uAccent : pick < 0.75 ? uCool : uPale;
    tint = mix(tint, vec3(0.80, 0.86, 1.0), 0.16 - uEnergy * 0.10);
    vec3 color = tint * energy * face;

    for (int i = 0; i < ${MAX_SWEEPS}; i++) {
      if (float(i) >= uSweepCount) break;
      float d = distance(vWorld.xz, uSweeps[i]);
      float core = exp(-pow(d / 2.4, 4.0));
      float skirt = exp(-pow(d / 4.8, 2.0)) * 0.3;
      color += uSweepColors[i] * (core + skirt) * uSweepGain * (0.55 + 0.45 * face);
    }

    if (uBallGain > 0.001) {
      vec3 ray = normalize(vWorld - uBall);
      float c = cos(uBallSpin);
      float s = sin(uBallSpin);
      ray.xz = vec2(c * ray.x - s * ray.z, s * ray.x + c * ray.z);
      vec2 g = vec2(atan(ray.z, ray.x) * (24.0 / 6.28318530718), acos(clamp(ray.y, -1.0, 1.0)) * (22.0 / 3.14159265359));
      vec2 tileId = floor(g);
      vec2 inTile = fract(g) - 0.5;
      float pickTile = hash(tileId + 5.7);
      float catches = step(0.62, pickTile);
      float spot = catches * (1.0 - smoothstep(0.16, 0.3, length(inTile)));
      float twinkle = 0.6 + 0.4 * sin(uTime * (2.0 + pickTile * 3.0) + pickTile * 40.0);
      float which = hash(tileId + 1.3) * 4.0;
      vec3 spotColor = which < 1.0 ? uBallColors[0] : which < 2.0 ? uBallColors[1] : which < 3.0 ? uBallColors[2] : uBallColors[3];
      color += mix(spotColor, vec3(1.0), 0.25) * spot * twinkle * uBallGain * 0.55;
    }

    color += vec3(0.16, 0.22, 0.38) * grout * (0.03 + energy * 0.3);

    color *= 1.0 - smoothstep(uRadius - 1.6, uRadius - 0.2, radius);

    color *= mix(1.0, 0.5, uReplay);
    if (uMeter > 0.001) {
      vec2 fromDeck = vWorld.xz - vec2(${DECK_POSITION.x.toFixed(2)}, ${DECK_POSITION.z.toFixed(2)});
      float r = length(fromDeck);
      float past = r - ${METER_INNER.toFixed(2)};
      if (past > -0.1 && past < ${(METER_REACH + 0.6).toFixed(2)}) {
        float around = fract(atan(fromDeck.x, fromDeck.y) / 6.28318530718 + 1.0);
        float slot = around * ${(BARS * 4).toFixed(1)};
        int index = int(slot);
        int quarter = index / ${BARS};
        vec2 bar = uMeterBars[index];
        float across = fract(slot);
        float body = step(0.14, across) * step(across, 0.86);
        float along = past / 0.46;
        float segment = step(0.2, fract(along));
        float lit = step(0.0, past) * step(past, bar.x) * segment;
        float tip = lit * (1.0 - smoothstep(0.0, 0.46, bar.x - past));
        float peak = step(0.0, past) * step(abs(past - bar.y - 0.12), 0.12) * step(0.05, bar.y);
        vec3 tint = uMeterColors[quarter];
        color += tint * body * (lit * 0.5 + tip * 0.9) * uMeter;
        color += mix(tint, vec3(1.0), 0.35) * body * peak * 1.4 * uMeter;
      }
      float ring = r - ${METER_INNER.toFixed(2)} - uKickAt * 9.0;
      float fade = (1.0 - uKickAt) * (1.0 - uKickAt);
      color += uMeterColors[0] * exp(-ring * ring * 14.0) * uKick * fade * 0.5 * uMeter;
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

const signalFragment = `
  uniform float uTime;
  uniform float uCount;
  uniform vec2 uOrigins[${MAX_SIGNALS}];
  uniform float uStrengths[${MAX_SIGNALS}];
  uniform vec3 uColors[${MAX_SIGNALS}];
  varying vec3 vWorld;

  void main() {
    vec3 glow = vec3(0.0);

    for (int i = 0; i < ${MAX_SIGNALS}; i++) {
      if (float(i) >= uCount) break;
      float strength = uStrengths[i];
      float d = distance(vWorld.xz, uOrigins[i]);
      float cycle = mod(uTime * mix(1.5, 2.3, strength), 16.0);
      float width = mix(1.9, 3.4, strength);
      float offset = (d - cycle) / width;
      float ring = exp(-offset * offset);
      float travelFade = 1.0 - smoothstep(7.0, 16.0, cycle);
      float distanceFade = exp(-d * 0.16);
      float localHalo = exp(-d * mix(0.62, 0.46, strength)) * (0.025 + strength * 0.075);
      glow += uColors[i] * (ring * distanceFade * travelFade * (0.035 + strength * 0.13) + localHalo);
    }

    gl_FragColor = vec4(glow, 1.0);
  }
`;

const sweepScratch = { x: 0, z: 0 };

export const replayMeter: { material: ShaderMaterial | null } = { material: null };

function driveMeter(
  state: GameState,
  now: number,
  beat: BeatInfo,
  audio: AudioFrame,
  dt: number,
  bars: Vector2[],
  kick: { beat: number; strength: number },
) {
  const clock = replayClock(state, now);
  const section = clock && clock.section >= 0 ? state.song.committed[clock.section] : null;
  const rise = 1 - Math.exp(-dt * 30);
  const fall = 1 - Math.exp(-dt * 6);
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const layer = QUARTER_LAYERS[quarter]!;
    const sounding = !!section?.layers[layer].sampleName;
    const level = audio.measured ? Math.min(1, audio.levels[layer] * 1.6) : sounding ? MADE_UP[layer](beat) : 0;
    const landing = clock ? platterMoment(state, clock, layer).landing : 0;
    for (let slot = 0; slot < BARS; slot += 1) {
      const edge = Math.abs((slot + 0.5) / BARS - 0.5) * 2;
      const band = audio.measured ? audio.bands[Math.round(edge * (audio.bands.length - 1))]! : 1 - edge * 0.55;
      const flutter = 0.82 + 0.3 * hash01(quarter * 131 + slot * 17 + beat.step * 7);
      const played = Math.min(1, level ** 0.8 * (0.3 + 0.7 * band) * (1 - edge * 0.35) * flutter);
      const want = Math.max(played, landing ** 1.5 * (1 - edge * 0.2)) * METER_REACH;
      const bar = bars[quarter * BARS + slot]!;
      bar.x += (want - bar.x) * (want > bar.x ? rise : fall);
      bar.y = Math.max(bar.y - dt * 2.4, bar.x);
    }
  }
  if (beat.beat !== kick.beat) {
    kick.beat = beat.beat;
    kick.strength = 0;
  }
  if (beat.beat % 4 === 0 && beat.beatPhase < 0.15) {
    const hit = audio.measured
      ? Math.min(1, Math.max(0, audio.low - 0.2) * 1.8)
      : section?.layers.DRUMS.sampleName ? 0.8 : 0;
    kick.strength = Math.max(kick.strength, hit);
  }
}

export function poseMeterForCover(layers: Record<LoopLayer, { sampleName: string | null }>): () => void {
  const uniforms = replayMeter.material?.uniforms as {
    uMeter: { value: number }; uKick: { value: number }; uKickAt: { value: number }; uMeterBars: { value: Vector2[] };
  } | undefined;
  const bars = uniforms?.uMeterBars.value;
  if (!uniforms || !bars) return () => {};
  const saved = bars.map((bar) => bar.clone());
  const was = { meter: uniforms.uMeter.value, kick: uniforms.uKick.value, kickAt: uniforms.uKickAt.value };
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const on = !!layers[QUARTER_LAYERS[quarter]!].sampleName;
    for (let slot = 0; slot < BARS; slot += 1) {
      const edge = Math.abs((slot + 0.5) / BARS - 0.5) * 2;
      const shape = on ? 0.3 + 0.64 * (1 - edge) ** 1.2 * (0.78 + 0.34 * hash01(quarter * 31 + slot * 7)) : 0.06;
      const bar = bars[quarter * BARS + slot]!;
      bar.x = Math.min(1, shape) * METER_REACH;
      bar.y = Math.min(METER_REACH, bar.x + 0.35 + 0.6 * hash01(slot * 13 + quarter));
    }
  }
  uniforms.uMeter.value = 1;
  uniforms.uKick.value = 0.8;
  uniforms.uKickAt.value = 0.4;
  return () => {
    saved.forEach((bar, index) => bars[index]!.copy(bar));
    uniforms.uMeter.value = was.meter;
    uniforms.uKick.value = was.kick;
    uniforms.uKickAt.value = was.kickAt;
  };
}

export function dullFloorForCover(): () => void {
  const was = { env: floorMaterial.envMapIntensity, roughness: floorMaterial.roughness };
  floorMaterial.envMapIntensity = was.env * 0.15;
  floorMaterial.roughness = 1;
  return () => {
    floorMaterial.envMapIntensity = was.env;
    floorMaterial.roughness = was.roughness;
  };
}

const MADE_UP: Record<LoopLayer, (beat: BeatInfo) => number> = {
  DRUMS: (beat) => 0.35 + beat.pulse * 0.6,
  BASS: (beat) => 0.5 + beat.pulse * 0.35,
  MUSIC: (beat) => 0.55 + Math.sin(beat.beatPhase * Math.PI) * 0.15,
  TOPS: (beat) => 0.3 + beat.stepPulse * 0.55,
};

function hash01(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const MIRROR = {
  color: '#05070d',
  roughness: 0.44,
  metalness: 0.18,
  mirror: 0.58,
  resolution: PERFORMANCE.reflectionResolution,
  blur: [300, 80] as [number, number],
  mixBlur: 1.0,
  mixStrength: 0.78,
  glow: 0.1,
  depthScale: 1.15,
  minDepthThreshold: 0.2,
  maxDepthThreshold: 1.2,
  depthToBlurRatioBias: 0.28,
};

const floorMaterial = PERFORMANCE.tier === 'low'
  ? new MeshStandardMaterial({ color: '#05070c', roughness: 0.88, metalness: 0.04, envMapIntensity: 0.35 })
  : (() => {
    const material = new MeshStandardMaterial({ color: MIRROR.color, roughness: MIRROR.roughness, metalness: MIRROR.metalness });
    material.color.multiplyScalar(1 - MIRROR.mirror);
    return material;
  })();

export function DiscoFloor() {
  const state = useGameStateWhen((room) => room.themeId);
  const runtime = useGameRuntime();
  const vibe = theme(state.themeId);
  const tileMaterial = useRef<ShaderMaterial>(null);
  const signalMaterial = useRef<ShaderMaterial>(null);
  const floor = useRef<Group>(null);
  const meterBars = useMemo(() => Array.from({ length: BARS * 4 }, () => new Vector2()), []);
  const meterColors = useMemo(() => QUARTER_LAYERS.map((layer) => new Color(LAYER_COLORS[layer])), []);
  const kick = useRef({ beat: -1, strength: 0 }).current;
  const sweeps = useSweeps(PERFORMANCE.movingLightCount, vibe.look.accent, vibe.look.secondary, vibe.look.sweepGain);

  const origins = useMemo(() => Array.from({ length: MAX_SIGNALS }, () => new Vector2(999, 999)), []);
  const strengths = useMemo(() => Array.from({ length: MAX_SIGNALS }, () => 0), []);
  const colors = useMemo(() => Array.from({ length: MAX_SIGNALS }, () => new Color('#ffffff')), []);
  const sweepSlots = useMemo(() => Array.from({ length: MAX_SWEEPS }, () => new Vector2(999, 999)), []);
  const sweepColors = useMemo(() => Array.from({ length: MAX_SWEEPS }, () => new Color('#000000')), []);

  const tileUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uBeat: { value: 0 },
    uEnergy: { value: 0 },
    uAccent: { value: new Color(vibe.look.accent) },
    uCool: { value: new Color(vibe.look.secondary) },
    uPale: { value: new Color('#b9cdf0') },
    uSweepCount: { value: sweeps.length },
    uSweeps: { value: sweepSlots },
    uSweepColors: { value: sweepColors },
    uSweepGain: { value: 0 },
    uRadius: { value: FLOOR_RADIUS },
    uTile: { value: vibe.look.tile },
    uLitGain: { value: vibe.look.litGain },
    uReplay: { value: 0 },
    uMeter: { value: 0 },
    uMeterBars: { value: meterBars },
    uMeterColors: { value: meterColors },
    uKick: { value: 0 },
    uKickAt: { value: 0 },
    uBall: { value: discoLight.position },
    uBallSpin: { value: 0 },
    uBallGain: { value: 0 },
    uBallColors: { value: discoLight.colors },
  }), [meterBars, meterColors, sweepColors, sweepSlots, sweeps.length, vibe.look.accent, vibe.look.secondary, vibe.look.litGain, vibe.look.tile]);

  useEffect(() => {
    const material = tileMaterial.current;
    replayMeter.material = material;
    return () => {
      if (replayMeter.material === material) replayMeter.material = null;
    };
  }, [tileUniforms]);

  const signalUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uCount: { value: 0 },
    uOrigins: { value: origins },
    uStrengths: { value: strengths },
    uColors: { value: colors },
  }), [colors, origins, strengths]);

  useFrame(({ clock }, delta) => {
    const state = runtime.getState();
    const now = runtime.now();
    const beat = beatInfo(state, now);
    const energy = showEnergy(state, now);
    const replay = finaleCut(state, now);
    floor.current?.scale.setScalar(replay ? REPLAY_FLOOR_SCALE : 1);

    if (tileMaterial.current) {
      const uniforms = tileMaterial.current.uniforms;
      uniforms.uTime!.value = clock.elapsedTime;
      uniforms.uBeat!.value = beat.beat + beat.beatPhase;
      uniforms.uEnergy!.value = energy;
      uniforms.uSweepCount!.value = sweeps.length;
      uniforms.uSweepGain!.value = 0.12 + energy * 0.3 + beat.pulse * 0.1 * energy;
      uniforms.uRadius!.value = FLOOR_RADIUS * (replay ? REPLAY_FLOOR_SCALE : 1);
      uniforms.uReplay!.value = replay ? 1 : 0;
      uniforms.uBallSpin!.value = discoLight.spin;
      uniforms.uBallGain!.value = replay ? 0 : discoLight.gain;
      const rise = finaleRise(state, now);
      uniforms.uMeter!.value = replay ? rise * rise * (3 - 2 * rise) : 0;
      if (replay) {
        driveMeter(state, now, beat, audioFrame(state, beat, clock.elapsedTime), Math.min(delta, 0.05), meterBars, kick);
        uniforms.uKick!.value = kick.strength;
        uniforms.uKickAt!.value = beat.beatPhase;
      }
      for (let i = 0; i < sweeps.length; i += 1) {
        sweepPosition(sweeps[i]!, rigTime(), sweepScratch);
        sweepSlots[i]!.set(sweepScratch.x, sweepScratch.z);
        sweepColors[i]!.copy(sweeps[i]!.color);
      }
    }

    const material = signalMaterial.current;
    if (!material) return;
    material.uniforms.uTime!.value = clock.elapsedTime;

    const signals: Array<{ x: number; z: number; strength: number; color: string }> = [];
    for (const station of Object.values(state.stations)) {
      if (signals.length >= MAX_SIGNALS) break;
      if (!station.busyUntil || now >= station.busyUntil) continue;
      const definition = STATION_BY_ID[station.id];
      if (!definition) continue;
      const at = stationPosition(definition);
      signals.push({ x: at.x, z: at.z, strength: 0.6, color: vibe.look.accent });
    }
    for (const block of Object.values(state.blocks)) {
      if (signals.length >= MAX_SIGNALS) break;
      if (block.status !== 'world' || !block.beacon) continue;
      signals.push({
        x: block.position.x,
        z: block.position.z,
        strength: 0.45,
        color: LAYER_COLORS[block.role],
      });
    }

    material.uniforms.uCount!.value = signals.length;
    const uniformOrigins = material.uniforms.uOrigins!.value as Vector2[];
    const uniformStrengths = material.uniforms.uStrengths!.value as number[];
    const uniformColors = material.uniforms.uColors!.value as Color[];
    for (let i = 0; i < MAX_SIGNALS; i += 1) {
      const signal = signals[i];
      uniformOrigins[i]!.set(signal?.x ?? 999, signal?.z ?? 999);
      uniformStrengths[i] = signal?.strength ?? 0;
      uniformColors[i]!.set(signal?.color ?? '#000000');
    }
  });

  return (
    <group ref={floor}>
      <mesh receiveShadow position={[0, -0.075, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floorMaterial}>
        <circleGeometry args={[FLOOR_RADIUS + 0.3, 96]} />
      </mesh>

      <mesh position={[0, -0.055, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <circleGeometry args={[FLOOR_RADIUS, 96]} />
        <shaderMaterial
          ref={tileMaterial}
          uniforms={tileUniforms}
          vertexShader={worldVertex}
          fragmentShader={tileFragment}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>

      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <circleGeometry args={[FLOOR_RADIUS, 96]} />
        <shaderMaterial
          ref={signalMaterial}
          uniforms={signalUniforms}
          vertexShader={worldVertex}
          fragmentShader={signalFragment}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
