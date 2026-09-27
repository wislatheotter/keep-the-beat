import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { ARENA_RADIUS, type ThemeLook } from '@loop/shared';
import { Color, type DirectionalLight, type HemisphereLight } from 'three';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { PERFORMANCE } from '../performance';
import { beatInfo, overtimeHeat, showEnergy } from '../beat';
import { LIVE_QUALITY } from '../liveQuality';

const KEY_INTENSITY = 0.92;

const OVERTIME_KEY = new Color('#ffb4b4');
const OVERTIME_RIM = new Color('#ff2f52');
const HEMI_INTENSITY = 0.46;
const SHADOW_FADE_PER_SECOND = 3;
const RIM_INTENSITY = 0.4;

const HALF_RATE_INTERVAL = 1 / 32;

export function KeyLights({ accent, look }: { accent: string; look: ThemeLook }) {
  const runtime = useGameRuntime();
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const keyColor = useRef(new Color());
  const rimColor = useRef(new Color());
  const gl = useThree((three) => three.gl);
  const sinceShadow = useRef(Infinity);

  useEffect(() => {
    if (!PERFORMANCE.shadows) return;
    gl.shadowMap.autoUpdate = false;
    return () => { gl.shadowMap.autoUpdate = true; };
  }, [gl]);
  useFrame((_, delta) => {
    const light = key.current;
    if (!PERFORMANCE.shadows || !light) return;
    const wanted = LIVE_QUALITY.shadows ? 1 : 0;
    const was = light.shadow.intensity;
    if (was !== wanted) {
      const step = Math.min(1, delta * SHADOW_FADE_PER_SECOND);
      light.shadow.intensity = wanted ? Math.min(1, was + step) : Math.max(0, was - step);
      if (wanted && was === 0) sinceShadow.current = Infinity;
    }
    if (light.shadow.intensity === 0) return;
    sinceShadow.current += delta;
    const interval = LIVE_QUALITY.shadowRate ? PERFORMANCE.shadowInterval : Math.max(PERFORMANCE.shadowInterval, HALF_RATE_INTERVAL);
    if (sinceShadow.current < interval) return;
    sinceShadow.current = 0;
    gl.shadowMap.needsUpdate = true;
  }, 0.5);

  useFrame(() => {
    const state = runtime.getState();
    const now = runtime.now();
    const beat = beatInfo(state, now);
    const energy = showEnergy(state, now);
    const heat = overtimeHeat(state, now);
    const house = 1 - energy * 0.26;
    if (key.current) {
      key.current.intensity = KEY_INTENSITY * look.keyGain * house;
      key.current.color.copy(keyColor.current.set(look.key)).lerp(OVERTIME_KEY, heat * 0.65);
    }
    if (hemi.current) hemi.current.intensity = HEMI_INTENSITY * look.keyGain * house * (1 - heat * 0.2);
    if (rim.current) {
      const strobe = heat > 0 ? (0.5 + 0.5 * Math.sin(now / 110)) * heat : 0;
      rim.current.intensity = RIM_INTENSITY + beat.pulse * 0.2 * (0.35 + energy) + strobe * 0.5;
      rim.current.color.copy(rimColor.current.set(accent)).lerp(OVERTIME_RIM, heat);
    }
  });

  const shadowExtent = ARENA_RADIUS + 4;

  return (
    <>
      <hemisphereLight ref={hemi} args={[look.sky, look.ground, HEMI_INTENSITY * look.keyGain]} />

      <directionalLight
        ref={key}
        castShadow={PERFORMANCE.shadows}
        position={[16, 24, 13]}
        intensity={KEY_INTENSITY * look.keyGain}
        color={look.key}
        shadow-mapSize={[PERFORMANCE.shadowMapSize, PERFORMANCE.shadowMapSize]}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-bias={-0.0002}
        shadow-normalBias={0.03}
      />

      <directionalLight position={[-15, 11, 9]} intensity={0.34} color={look.sky} />

      <directionalLight ref={rim} position={[-6, 13, -20]} intensity={RIM_INTENSITY} color={accent} />

      <directionalLight position={[4, 6, 17]} intensity={0.2} color="#b9d0ff" />
    </>
  );
}
