import { useGLTF, useTexture } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  type Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  Points,
  type PointLight,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { DECK_POSITION, LAYER_COLORS, LOOP_LAYERS, theme } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { PERFORMANCE } from '../performance';
import { beatInfo, showEnergy } from '../beat';
import { finaleCut, window01 } from '../stage';
import { DEV_HANDLE } from '../../runtime/devFlag';

export const BALL_FILE = '/props/disco-ball/disco-ball.glb';
export const BALL_TEXTURE = '/props/disco-ball/DiscoUV.png';
const DRACO_DECODER = '/draco/';

const BALL_UP = 13.2;
const BALL_DOWN = 6.9;
const BALL_SCALE = 1.25;
const CEILING = 19;
const GLINTS = PERFORMANCE.tier === 'low' ? 18 : 40;
const PRIME_FRAMES = 3;
const RAY_COUNT = PERFORMANCE.tier === 'low' ? 5 : 8;

export const discoLight = {
  position: new Vector3(DECK_POSITION.x, BALL_UP, DECK_POSITION.z),
  spin: 0,
  gain: 0,
  colors: [new Color('#ffffff'), new Color('#ffffff'), new Color('#ffffff'), new Color('#ffffff')],
};

const starTexture = (() => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 18);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [w, h] of [[3, 30], [30, 3]] as const) {
    const ray = context.createLinearGradient(32 - w, 32 - h, 32 + w, 32 + h);
    ray.addColorStop(0, 'rgba(255,255,255,0)');
    ray.addColorStop(0.5, 'rgba(255,255,255,1)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = ray;
    context.beginPath();
    context.ellipse(32, 32, w, h, 0, 0, Math.PI * 2);
    context.fill();
  }
  return new CanvasTexture(canvas);
})();

function glintPoints(count: number) {
  const positions = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    positions.set([Math.cos(golden * i) * r * 1.02, y * 1.02, Math.sin(golden * i) * r * 1.02], i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute('size', new BufferAttribute(new Float32Array(count), 1).setUsage(DynamicDrawUsage));
  const material = new ShaderMaterial({
    uniforms: { uMap: { value: starTexture }, uScale: { value: 300 } },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      uniform float uScale;
      void main() {
        vColor = color;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vec3 normal = normalize(normalMatrix * normalize(position));
        float facing = step(0.0, dot(normal, normalize(-view.xyz)));
        gl_PointSize = size * facing * uScale / max(0.1, -view.z);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      varying vec3 vColor;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * a, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return points;
}

function rayMaterial() {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color('#ffffff') }, uIntensity: { value: 0 } },
    vertexShader: `
      varying float vAlong;
      varying float vEdge;
      void main() {
        vAlong = uv.y;
        vec3 n = normalize(normalMatrix * normal);
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vEdge = 1.0 - abs(dot(n, normalize(-view.xyz)));
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vAlong;
      varying float vEdge;
      void main() {
        float fade = pow(clamp(vAlong, 0.0, 1.0), 1.8);
        float edge = 0.25 + 0.75 * vEdge * vEdge;
        gl_FragColor = vec4(uColor * uIntensity * fade * edge, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    forceSinglePass: true,
    blending: AdditiveBlending,
  });
}

export function DiscoBall() {
  const runtime = useGameRuntime();
  const state = useGameStateWhen((room) => room.themeId);
  const vibe = theme(state.themeId);
  const camera = useThree((three) => three.camera) as PerspectiveCamera;
  const viewport = useThree((three) => three.size);
  const gl = useThree((three) => three.gl);
  const { scene } = useGLTF(BALL_FILE, DRACO_DECODER) as unknown as { scene: Group };
  const map = useTexture(BALL_TEXTURE);

  const drop = useRef<Group>(null);
  const spinner = useRef<Group>(null);
  const cable = useRef<Mesh>(null);
  const rays = useRef<Group>(null);
  const primed = useRef<Mesh[]>([]);
  const lamp = useRef<PointLight>(null);
  const fittings = useRef<MeshStandardMaterial[]>([]);
  const motion = useRef({ y: BALL_UP, velocity: 0, down: false, groove: 0, seen: 1 });
  const priming = useRef(PRIME_FRAMES);

  const material = useMemo(() => {
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 4;
    return new MeshStandardMaterial({
      transparent: true,
      map,
      color: '#f2f5ff',
      metalness: 1,
      roughness: 0.16,
      flatShading: true,
      envMapIntensity: 1.8,
      emissive: new Color(),
      emissiveMap: map,
      emissiveIntensity: 0.05,
    });
  }, [map]);
  useEffect(() => {
    material.emissive.set(vibe.look.accent);
  }, [material, vibe.look.accent]);
  const ball = useMemo(() => {
    const source = scene.getObjectByProperty('type', 'Mesh') as Mesh | undefined;
    if (!source) throw new Error('disco-ball.glb has no mesh');
    const mesh = new Mesh(source.geometry, material);
    mesh.scale.setScalar(BALL_SCALE);
    return mesh;
  }, [scene, material]);
  const glints = useMemo(() => glintPoints(GLINTS), []);
  const rayMaterials = useMemo(() => Array.from({ length: RAY_COUNT }, () => rayMaterial()), []);
  useEffect(() => {
    if (!DEV_HANDLE) return;
    const handle = ((window as unknown as { __loop?: Record<string, unknown> }).__loop ??= {});
    handle.disco = discoLight;
  }, []);
  useEffect(() => {
    gl.initTexture(map);
    if (starTexture) gl.initTexture(starTexture);
  }, [gl, map]);
  useEffect(() => {
    ball.frustumCulled = false;
    for (const ray of primed.current) ray.frustumCulled = false;
    priming.current = PRIME_FRAMES;
  }, [ball]);
  useEffect(() => () => {
    material.dispose();
    glints.geometry.dispose();
    (glints.material as ShaderMaterial).dispose();
    for (const ray of rayMaterials) ray.dispose();
  }, [material, glints, rayMaterials]);

  const palette = useMemo(() => {
    const accent = new Color();
    const secondary = new Color();
    const white = new Color('#ffffff');
    return {
      accent,
      secondary,
      white,
      layers: LOOP_LAYERS.map((layer) => new Color(LAYER_COLORS[layer])),
      fallback: [accent, secondary, white, accent],
      scratch: new Color(),
    };
  }, []);
  useEffect(() => {
    palette.accent.set(vibe.look.accent);
    palette.secondary.set(vibe.look.secondary);
  }, [palette, vibe.look.accent, vibe.look.secondary]);

  useFrame(({ clock }, delta) => {
    const state = runtime.getState();
    const now = runtime.now();
    const dt = Math.min(delta, 0.05);
    const time = clock.elapsedTime;
    const energy = showEnergy(state, now);
    const beat = beatInfo(state, now);
    const m = motion.current;

    const sounding = LOOP_LAYERS.filter((layer) => state.song.layers[layer].sampleName).length;
    const groove = state.phase === 'playing' ? energy * 0.75 + Math.min(1, sounding / 3) * 0.25 : 0;
    m.groove += (groove - m.groove) * Math.min(1, dt * 1.5);
    if (!m.down && m.groove > 0.5 && sounding >= 2) m.down = true;
    else if (m.down && (m.groove < 0.36 || sounding < 2)) m.down = false;

    const reach = Math.hypot(camera.position.x - DECK_POSITION.x, camera.position.z - DECK_POSITION.z);
    m.seen += (window01(reach, 9, 16) - m.seen) * Math.min(1, dt * 4);
    const seen = m.seen;
    const away = finaleCut(state, now) ? 1 : 0;
    const target = BALL_UP - (BALL_UP - BALL_DOWN) * (m.down ? 1 : 0) * (1 - away);
    m.velocity += ((target - m.y) * 9 - m.velocity * 4.2) * dt;
    m.y += m.velocity * dt;
    const lowered = MathUtils.clamp((BALL_UP - m.y) / (BALL_UP - BALL_DOWN), 0, 1);

    if (drop.current) drop.current.position.y = m.y;
    if (cable.current) {
      const length = CEILING - m.y;
      cable.current.scale.y = length;
      cable.current.position.y = length / 2 + BALL_SCALE;
    }

    const colors = discoLight.colors;
    let filled = 0;
    for (let index = 0; index < LOOP_LAYERS.length; index += 1) {
      if (state.song.layers[LOOP_LAYERS[index]!].sampleName && filled < colors.length) colors[filled++]!.copy(palette.layers[index]!);
    }
    for (let i = 0; filled < colors.length; i += 1) colors[filled++]!.copy(palette.fallback[i % palette.fallback.length]!);

    const spin = (0.25 + energy * 0.55) * (0.4 + lowered * 0.6);
    discoLight.spin += dt * spin;
    if (spinner.current) spinner.current.rotation.y = discoLight.spin;
    discoLight.position.set(DECK_POSITION.x, m.y, DECK_POSITION.z);
    discoLight.gain = lowered * (0.55 + energy * 0.45) * (0.75 + beat.pulse * 0.5) * (1 - away);

    material.emissive.copy(colors[Math.floor(beat.beat) % 4]!);
    material.emissiveIntensity = 0.04 + lowered * (0.05 + beat.pulse * 0.25);
    material.opacity = seen;
    material.depthWrite = seen > 0.99;
    for (const fitting of fittings.current) {
      fitting.opacity = seen;
      fitting.depthWrite = seen > 0.99;
    }
    if (spinner.current) spinner.current.visible = seen > 0.005 || priming.current > 0;

    const sizes = glints.geometry.getAttribute('size') as BufferAttribute;
    const tints = glints.geometry.getAttribute('color') as BufferAttribute;
    const sparkle = vibe.look.sparkle;
    for (let i = 0; i < GLINTS; i += 1) {
      const phase = Math.sin(time * (2.4 + (i % 5) * 0.6) + i * 2.399) * 0.5 + 0.5;
      const flash = phase ** 6 * (0.5 + energy) * sparkle + beat.pulse * (i % 3 === 0 ? 0.6 : 0) * lowered;
      sizes.setX(i, (0.18 + flash * 0.9) * (0.35 + lowered * 0.65));
      palette.scratch.copy(i % 3 === 0 ? palette.white : colors[i % 4]!);
      const shine = (0.6 + flash * 2.2) * seen;
      tints.setXYZ(i, palette.scratch.r * shine, palette.scratch.g * shine, palette.scratch.b * shine);
    }
    sizes.needsUpdate = true;
    tints.needsUpdate = true;
    (glints.material as ShaderMaterial).uniforms.uScale!.value = viewport.height / (2 * Math.tan((camera.fov * Math.PI) / 360));

    if (rays.current) {
      rays.current.rotation.y = -discoLight.spin * 0.8;
      rays.current.visible = (lowered > 0.05 && energy > 0.12 && seen > 0.005) || priming.current > 0;
      rays.current.scale.setScalar(0.85 + energy * 0.3 + beat.pulse * 0.06);
      rayMaterials.forEach((ray, i) => {
        ray.uniforms.uColor!.value.copy(colors[i % 4]!);
        ray.uniforms.uIntensity!.value = (0.22 + energy * 0.25 + beat.pulse * 0.3) * lowered * seen;
      });
    }
    if (priming.current > 0) {
      priming.current -= 1;
      const culled = priming.current === 0;
      ball.frustumCulled = culled;
      for (const ray of primed.current) ray.frustumCulled = culled;
    }
    if (lamp.current) {
      lamp.current.intensity = (PERFORMANCE.tier === 'low' ? 1.4 : 2.6) * (0.4 + lowered * 0.8 + beat.pulse * 0.4 * lowered) * (1 - away);
      lamp.current.color.copy(colors[0]!).lerp(palette.white, 0.55);
    }
  });

  return (
    <group ref={drop} position={[DECK_POSITION.x, BALL_UP, DECK_POSITION.z]}>
      <mesh ref={cable} position={[0, 3, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 1, 6]} />
        <meshStandardMaterial ref={(node) => { if (node) fittings.current[0] = node; }} transparent color="#1a2030" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0, BALL_SCALE + 0.05, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 0.14, 12]} />
        <meshStandardMaterial ref={(node) => { if (node) fittings.current[1] = node; }} transparent color="#c9d2e4" metalness={0.9} roughness={0.25} />
      </mesh>
      <group ref={spinner}>
        <primitive object={ball} />
        <primitive object={glints} scale={BALL_SCALE} />
      </group>

      {PERFORMANCE.volumetricLights && (
        <group ref={rays}>
          {Array.from({ length: RAY_COUNT }, (_, i) => {
            const angle = (i / RAY_COUNT) * Math.PI * 2;
            const tilt = 0.62 + (i % 3) * 0.22;
            return (
              <group key={i} rotation={[0, angle, 0]}>
                <mesh ref={(node) => { if (node) primed.current[i] = node; }} rotation={[tilt, 0, 0]} position={[0, -4.6, 0]} material={rayMaterials[i]} renderOrder={5}>
                  <coneGeometry args={[1.3, 11, 16, 1, true]} />
                </mesh>
              </group>
            );
          })}
        </group>
      )}
      <pointLight ref={lamp} color="#dbe6ff" intensity={PERFORMANCE.tier === 'low' ? 1.4 : 2.6} distance={16} decay={2} />
    </group>
  );
}

useGLTF.preload(BALL_FILE, DRACO_DECODER);
useTexture.preload(BALL_TEXTURE);
