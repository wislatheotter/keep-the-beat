import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Object3D,
  type Group,
  type ShaderMaterial,
  type SpotLight,
} from 'three';
import { ARENA_RADIUS, theme } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { PERFORMANCE } from '../performance';
import { beatInfo, pressure, showEnergy } from '../beat';
import { finaleCut } from '../stage';
import { FORCE_SINGLE_PASS } from './singlePass';

const RIG_Y = 13.5;

const SPOT_BASE = 11;
const SPOT_RANGE = 26;

export type Sweep = {
  reach: number;
  speed: number;
  phase: number;
  ratio: number;
  color: Color;
};

export function useSweeps(count: number, accent: string, secondary: string, speedGain = 1): Sweep[] {
  return useMemo(() => {
    const warm = new Color(accent);
    const cold = new Color(accent).offsetHSL(0.42, -0.06, 0.06);
    const pale = new Color('#cfe0ff');
    const hot = new Color(secondary).lerp(new Color('#ffffff'), 0.25);
    const palette = [warm, cold, pale, hot];
    return Array.from({ length: count }, (_, i) => ({
      reach: 0.54 + (i % 2) * 0.16,
      speed: (0.21 + i * 0.043) * speedGain,
      phase: (i / count) * Math.PI * 2,
      ratio: 1.0 + (i % 3) * 0.37,
      color: palette[i % palette.length]!.clone(),
    }));
  }, [accent, count, secondary, speedGain]);
}

export function sweepPosition(sweep: Sweep, time: number, out: { x: number; z: number }) {
  const t = time * sweep.speed + sweep.phase;
  const reach = ARENA_RADIUS * sweep.reach;
  out.x = Math.sin(t) * reach;
  out.z = Math.cos(t * sweep.ratio) * reach;
}

const scratch = { x: 0, z: 0 };

let sweepTime = 0;
export const rigTime = () => sweepTime;

export function RigClock() {
  const runtime = useGameRuntime();
  useFrame((_, delta) => {
    const state = runtime.getState();
    sweepTime += Math.min(delta, 0.1) * (1 + pressure(state, runtime.now()) * 1.6);
  }, -1);
  return null;
}

const coneVertex = `
  varying vec2 vUv;
  varying vec3 vNormalView;
  void main() {
    vUv = uv;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const coneFragment = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormalView;
  void main() {
    float height = pow(max(vUv.y, 0.0), 1.5);
    float rim = pow(max(1.0 - abs(vNormalView.z), 0.0), 1.7);
    gl_FragColor = vec4(uColor, height * (0.12 + rim * 0.88) * uOpacity);
  }
`;

export function ClubLights() {
  const state = useGameStateWhen((room) => room.themeId);
  const runtime = useGameRuntime();
  const vibe = theme(state.themeId);
  const sweeps = useSweeps(PERFORMANCE.movingLightCount, vibe.look.accent, vibe.look.secondary, vibe.look.sweepGain);
  const cones = useRef<Array<Group | null>>([]);
  const coneMaterials = useRef<Array<ShaderMaterial | null>>([]);
  const spots = useRef<Array<SpotLight | null>>([]);
  const targets = useMemo(() => sweeps.map(() => new Object3D()), [sweeps]);

  useFrame(() => {
    const state = runtime.getState();
    const time = rigTime();
    const now = runtime.now();
    const beat = beatInfo(state, now);
    const energy = showEnergy(state, now);
    const drive = 0.34 + energy * 0.66 + beat.pulse * 0.2 * energy + pressure(state, now) * (0.25 + beat.pulse * 0.3);
    const haze = finaleCut(state, now) ? 0 : 1;

    for (let i = 0; i < sweeps.length; i += 1) {
      const sweep = sweeps[i]!;
      sweepPosition(sweep, time, scratch);
      const cone = cones.current[i];
      if (cone) {
        cone.position.set(scratch.x, 0, scratch.z);
        cone.rotation.z = Math.atan2(-scratch.x, RIG_Y) * 0.55;
        cone.rotation.x = Math.atan2(scratch.z, RIG_Y) * 0.55;
      }
      const material = coneMaterials.current[i];
      if (material) {
        material.uniforms.uOpacity!.value = (0.06 + drive * 0.11 + Math.sin(time * 1.7 + sweep.phase) * 0.015) * haze;
      }
      const spot = spots.current[i];
      if (spot) {
        spot.position.set(scratch.x * 0.35, RIG_Y, scratch.z * 0.35);
        const target = targets[i]!;
        target.position.set(scratch.x, 0, scratch.z);
        target.updateMatrixWorld();
        spot.intensity = SPOT_BASE + drive * SPOT_RANGE;
      }
    }
  });

  return (
    <group>
      {sweeps.map((sweep, i) => (
        <group key={i}>
          {PERFORMANCE.volumetricLights && (
            <group ref={(node) => { cones.current[i] = node; }}>
              <mesh position={[0, RIG_Y / 2, 0]} renderOrder={2}>
                <cylinderGeometry args={[0.55, 3.1, RIG_Y, 24, 1, true]} />
                <shaderMaterial
                  ref={(node) => { coneMaterials.current[i] = node; }}
                  uniforms={{ uColor: { value: sweep.color }, uOpacity: { value: 0.1 } }}
                  vertexShader={coneVertex}
                  fragmentShader={coneFragment}
                  transparent
                  depthWrite={false}
                  side={DoubleSide}
                  forceSinglePass={FORCE_SINGLE_PASS}
                  blending={AdditiveBlending}
                />
              </mesh>
            </group>
          )}
          {PERFORMANCE.spotLights && (
            <>
              <primitive object={targets[i]!} />
              <spotLight
                ref={(node) => { spots.current[i] = node; }}
                color={sweep.color}
                angle={0.34}
                penumbra={0.85}
                distance={34}
                decay={1.5}
                intensity={SPOT_BASE}
                target={targets[i]!}
                castShadow={false}
              />
            </>
          )}
        </group>
      ))}
    </group>
  );
}
