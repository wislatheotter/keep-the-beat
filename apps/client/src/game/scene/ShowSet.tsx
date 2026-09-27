import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, Color, DoubleSide, type Group, type MeshBasicMaterial, type MeshStandardMaterial } from 'three';
import { REPLAY_HALF_WIDTH, theme } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { beatInfo, stagePower } from '../beat';
import { LOBBY_Z, REPLAY_FRAME, REPLAY_ORIGIN, REPLAY_SCALE, RIG_FEET, finaleCut } from '../stage';
import { FORCE_SINGLE_PASS } from './singlePass';

export function ShowSet() {
  return (
    <>
      <LobbySpot />
      <ReplayPlatform />
    </>
  );
}

function LobbySpot() {
  const runtime = useGameRuntime();
  const root = useRef<Group>(null);
  const uniforms = useMemo(() => ({ uColor: { value: new Color('#ffe2b8') }, uOpacity: { value: 0 } }), []);
  const poolUniforms = useMemo(() => ({ uColor: { value: new Color('#ffd6a0') }, uOpacity: { value: 0 } }), []);

  useFrame(() => {
    const state = runtime.getState();
    const now = runtime.now();
    const lit = state.phase === 'lobby' ? 1 : 1 - stagePower(state, now);
    if (root.current) root.current.visible = lit > 0.01;
    poolUniforms.uOpacity.value = 0.34 * lit;
    uniforms.uOpacity.value = 0.34 * lit;
  });

  return (
    <group ref={root} position={[0, 0, LOBBY_Z + 0.2]}>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.9, 1, 1]} renderOrder={1}>
        <planeGeometry args={[6.4, 6.4]} />
        <shaderMaterial
          uniforms={poolUniforms}
          vertexShader={POOL_VERTEX}
          fragmentShader={POOL_FRAGMENT}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh position={[0, 6.5, -0.6]} scale={[1.9, 1, 1]} renderOrder={2}>
        <cylinderGeometry args={[0.7, 3.1, 13, 32, 1, true]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={BEAM_VERTEX}
          fragmentShader={BEAM_FRAGMENT}
          transparent
          depthWrite={false}
          side={DoubleSide}
          forceSinglePass={FORCE_SINGLE_PASS}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

const POOL_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const POOL_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float pool = 1.0 - smoothstep(0.35, 1.0, d);
    gl_FragColor = vec4(uColor, pool * pool * uOpacity);
  }
`;

const BEAM_VERTEX = `
  varying vec2 vUv;
  varying vec3 vNormalView;
  void main() {
    vUv = uv;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BEAM_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormalView;
  void main() {
    float floorward = pow(max(1.0 - vUv.y, 0.0), 1.4);
    float rim = pow(max(1.0 - abs(vNormalView.z), 0.0), 1.6);
    gl_FragColor = vec4(uColor, floorward * (0.1 + rim * 0.9) * uOpacity);
  }
`;

function ReplayPlatform() {
  const state = useGameStateWhen((room) => room.themeId);
  const runtime = useGameRuntime();
  const look = theme(state.themeId).look;
  const root = useRef<Group>(null);
  const lip = useRef<MeshStandardMaterial>(null);
  const glow = useRef<MeshBasicMaterial>(null);
  const width = (REPLAY_HALF_WIDTH + 1.25) * 2;
  const top = -RIG_FEET * REPLAY_SCALE;

  useFrame(() => {
    const state = runtime.getState();
    const node = root.current;
    if (!node) return;
    const now = runtime.now();
    const showing = finaleCut(state, now);
    node.visible = showing;
    if (!showing) return;
    const beat = beatInfo(state, now);
    if (lip.current) lip.current.emissiveIntensity = 1.2 + beat.pulse * 1.6;
    if (glow.current) glow.current.opacity = 0.18 + beat.pulse * 0.22;
  });

  return (
    <group ref={root} name="replay-ledge" position={REPLAY_ORIGIN} quaternion={REPLAY_FRAME} visible={false}>
      <mesh position={[0, top - 0.2, 0]} receiveShadow>
        <boxGeometry args={[width, 0.4, 1.7]} />
        <meshStandardMaterial color="#121723" metalness={0.45} roughness={0.5} envMapIntensity={0.7} />
      </mesh>
      <mesh position={[0, top + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width - 0.1, 1.6]} />
        <meshStandardMaterial color="#1f2636" metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[0, top - 0.06, 0.86]}>
        <boxGeometry args={[width, 0.09, 0.05]} />
        <meshStandardMaterial ref={lip} color={look.accent} emissive={look.accent} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <mesh position={[0, top - 0.26, 0.87]} renderOrder={2}>
        <planeGeometry args={[width, 0.42]} />
        <meshBasicMaterial ref={glow} color={look.accent} transparent opacity={0.2} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}
