import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  type Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  LAYER_COLORS,
  RACK_SLOTS,
  RACK_STACK_FORWARD,
  rackContents,
  rackSlotPosition,
  type SampleRole,
  type StationDefinition,
  type StationState,
  type ThemeLook,
  barDurationMs,
  theme,
} from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { PERFORMANCE } from '../performance';
import { decorativeMotion } from '../motion';
import { eyeOpenness } from '../stationPersonality';
import { beatInfo, type BeatInfo } from '../beat';
import { auraPulse, createAuraMaterial, fadeAura } from '../aura';
import { livePlayer, useFocusStore } from '../interaction';
import { easeOutBack } from '../stage';
import { PEDESTAL_TOP, PILE_STEP, STATION_SCALE, pileArrival, pileCount, restockProgress } from '../crate';
import { markScenery } from './sceneryBatches';
import { isTrim, paintTrim, stageTrim } from './stageTrim';

export const STATIONS_FILE = '/stations/stations.glb';
const DRACO_DECODER = '/draco/';

type Kind = 'Body' | 'Accent' | 'Glow' | 'Pulse' | 'Dark' | 'Metal' | 'Brass' | 'Cream' | 'Wood';

type Materials = Record<Kind, MeshStandardMaterial>;

function createMaterials(role: SampleRole, look: ThemeLook): Materials {
  const color = new Color(LAYER_COLORS[role]);
  const light = color.clone().lerp(new Color('#ffffff'), 0.62);
  const standard = (hex: Color | string, roughness: number, metalness = 0) => new MeshStandardMaterial({
    color: hex, roughness, metalness, envMapIntensity: 0.9,
  });
  const body = standard(color, 0.32, 0.18);
  body.emissive = color.clone();
  body.emissiveIntensity = 0.075;
  const glow = standard(color, 0.4);
  glow.emissive = color.clone();
  glow.emissiveIntensity = 1.2;
  glow.toneMapped = false;
  const pulse = standard(light, 0.4);
  pulse.emissive = color.clone();
  pulse.emissiveIntensity = 0.5;
  pulse.toneMapped = false;
  const trim = stageTrim(look);
  return {
    Body: body,
    Accent: standard(light, 0.5),
    Glow: glow,
    Pulse: pulse,
    Dark: trim.Dark,
    Metal: trim.Metal,
    Brass: trim.Brass,
    Cream: trim.Cream,
    Wood: trim.Wood,
  };
}

type Rest = { position: Vector3; quaternion: Quaternion; scale: Vector3 };
type Model = { root: Object3D; parts: Map<string, Object3D>; rest: Map<string, Rest>; materials: Materials };

function useStationModel(role: SampleRole, look: ThemeLook): Model {
  const { scene } = useGLTF(STATIONS_FILE, DRACO_DECODER) as unknown as { scene: Group };
  const model = useMemo(() => {
    const source = scene.getObjectByName(`Station_${role}`);
    if (!source) throw new Error(`stations.glb has no Station_${role}`);
    const root = markScenery(source.clone(true));
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    const materials = createMaterials(role, look);
    const parts = new Map<string, Object3D>();
    const rest = new Map<string, Rest>();
    for (const child of root.children) {
      const part = child.name.slice(role.length + 1);
      parts.set(part, child);
      rest.set(part, { position: child.position.clone(), quaternion: child.quaternion.clone(), scale: child.scale.clone() });
    }
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const name = (object.material as { name?: string }).name ?? '';
      const kind = (name.includes('.') ? name.split('.')[1] : name) as Kind;
      object.material = materials[kind] ?? materials.Dark;
      object.castShadow = PERFORMANCE.shadows && /_(Static|Backdrop|Guitar|Face|Mounts)$/.test(object.parent?.name ?? object.name);
      object.receiveShadow = true;
    });
    return { root, parts, rest, materials };
  }, [scene, role]);
  useEffect(() => paintTrim(look), [look]);
  useEffect(() => () => {
    for (const material of Object.values(model.materials)) if (!isTrim(material)) material.dispose();
  }, [model]);
  return model;
}

const pileGeometry = (() => {
  const paint = (geometry: CylinderGeometry, rgb: [number, number, number]) => {
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) colors.set(rgb, i * 3);
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geometry;
  };
  const disc = paint(new CylinderGeometry(0.7, 0.7, PILE_STEP * 0.78, 32), [0.02, 0.022, 0.03]);
  const label = paint(new CylinderGeometry(0.28, 0.28, PILE_STEP * 0.8, 20), [1, 1, 1]);
  const rim = paint(new CylinderGeometry(0.705, 0.705, PILE_STEP * 0.26, 32, 1, true), [0.7, 0.7, 0.7]);
  return mergeGeometries([disc.toNonIndexed(), label.toNonIndexed(), rim.toNonIndexed()])!;
})();
const pileMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.1, envMapIntensity: 0.8 });
const PILE_MAX = 4;

function Pile({ station, role, size }: { station: StationState; role: SampleRole; size: number }) {
  const runtime = useGameRuntime();
  const mesh = useMemo(() => {
    const instanced = new InstancedMesh(pileGeometry, pileMaterial, PILE_MAX);
    instanced.instanceMatrix.setUsage(DynamicDrawUsage);
    const color = new Color(LAYER_COLORS[role]);
    for (let i = 0; i < PILE_MAX; i += 1) instanced.setColorAt(i, color);
    instanced.castShadow = PERFORMANCE.shadows;
    instanced.receiveShadow = true;
    return instanced;
  }, [role]);
  useEffect(() => () => mesh.dispose(), [mesh]);

  const shown = pileCount(size);
  const matrix = useMemo(() => new Matrix4(), []);
  const q = useMemo(() => new Quaternion(), []);
  const e = useMemo(() => new Euler(), []);
  const p = useMemo(() => new Vector3(), []);
  const s = useMemo(() => new Vector3(), []);
  const settled = useRef({ shown, at: 0, from: shown });
  if (settled.current.shown !== shown) settled.current = { shown, at: runtime.now(), from: settled.current.shown };

  useFrame(() => {
    const now = runtime.now();
    const drop = settled.current;
    const t = MathUtils.clamp((now - drop.at) / 380, 0, 1);
    const bounce = drop.from > drop.shown || t < 1 ? Math.sin(t * Math.PI * 2.2) * (1 - t) * 0.035 : 0;
    for (let i = 0; i < PILE_MAX; i += 1) {
      const arrival = pileArrival(station, i, now);
      const visible = i < shown && arrival > 0;
      const pop = arrival < 1 ? easeOutBack(arrival) : 1;
      e.set(Math.sin(i * 2.3) * 0.03, i * 1.7, Math.cos(i * 1.9) * 0.03);
      q.setFromEuler(e);
      p.set(Math.sin(i * 3.1) * 0.025, PEDESTAL_TOP + PILE_STEP * (i + 0.5) + bounce * (i + 1) * 0.3 - (1 - pop) * 0.2, Math.cos(i * 2.7) * 0.025);
      s.setScalar(visible ? Math.max(0.001, pop) : 0.001);
      matrix.compose(p, q, s);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}

const tmpQ = new Quaternion();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const stackWorld = new Vector3();

export function RecordStation({ definition, station }: { definition: StationDefinition; station: StationState }) {
  const state = useGameStateWhen((room) => [room.themeId, room.bpm, room.phase, rackContents(room, definition.id).map((block) => block.id)]);
  const runtime = useGameRuntime();
  const role = definition.role!;
  const look = theme(state.themeId).look;
  const barSeconds = barDurationMs(state.bpm) / 1000;
  const model = useStationModel(role, look);
  const dealt = useMemo(() => rackContents(state, definition.id).length, [state, definition.id]);
  const size = state.phase === 'lobby' ? RACK_SLOTS : dealt;
  const focused = useFocusStore((store) => store.focus.stationId === definition.id);
  const halo = useMemo(() => createAuraMaterial(LAYER_COLORS[role]), [role]);
  useEffect(() => () => halo.dispose(), [halo]);

  const stack = useMemo(() => rackSlotPosition(definition, 0), [definition]);
  const live = useRef(0);
  const near = useRef(0);
  const feedFlash = useRef(0);
  const lastTop = useRef<string | null>(null);
  const topId = useMemo(() => rackContents(state, definition.id)[0]?.id ?? null, [state, definition.id]);

  useFrame((_, delta) => {
    const state = runtime.getState();
    const now = runtime.now();
    const beat = beatInfo(state, now);
    const dt = Math.min(delta, 0.05);
    const sounding = state.song.layers[role as 'DRUMS']?.sampleName ? 1 : 0;
    live.current += (sounding - live.current) * Math.min(1, dt * 3);
    const amp = 0.22 + live.current * 0.78;

    stackWorld.set(stack.x, 0, stack.z);
    const distance = livePlayer.known ? Math.hypot(livePlayer.position.x - stackWorld.x, livePlayer.position.z - stackWorld.z) : 99;
    const approach = MathUtils.smoothstep(7.5 - distance, 0, 4);
    near.current += (approach - near.current) * Math.min(1, dt * 6);

    if (topId !== lastTop.current) {
      if (lastTop.current !== null) feedFlash.current = 1;
      lastTop.current = topId;
    }
    feedFlash.current = Math.max(0, feedFlash.current - dt * 2.4);
    const delivery = 1 - restockProgress(station, now);

    const { materials } = model;
    const empty = size === 0;
    const focus = focused ? auraPulse(now) : 0;
    materials.Glow.emissiveIntensity = empty
      ? 0.25
      : 0.9 + near.current * 0.9 + focus * 1.6 + feedFlash.current * 3 + delivery * 2.5 + beat.pulse * 0.35 * amp;
    materials.Pulse.emissiveIntensity = 0.35 + beat.pulse * 1.3 * amp + feedFlash.current * 1.2;
    fadeAura(halo, focused ? auraPulse(now) : 0, dt);

    if (!PERFORMANCE.stillScenery) animate[role]?.(model, beat, now, amp * decorativeMotion(), barSeconds);
    const arrow = pose(model, 'Arrow');
    if (arrow) {
      const me = state.players[runtime.playerId];
      arrow.visible = state.phase === 'playing' && !me?.heldBlockId && !empty && distance < 5;
      arrow.position.y += Math.sin(now / 420) * .035 * decorativeMotion();
    }
  });

  return (
    <group scale={STATION_SCALE}>
      <primitive object={model.root} />
      <group position={[0, 0, RACK_STACK_FORWARD / STATION_SCALE]}>
        <Pile station={station} role={role} size={size} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} material={halo} renderOrder={3}>
          <ringGeometry args={[0.98, 1.2, 48]} />
        </mesh>
      </group>
    </group>
  );
}

type Animator = (model: Model, beat: BeatInfo, now: number, amp: number, barSeconds: number) => void;

function pose(model: Model, name: string, axis?: Vector3, angle = 0): Object3D | null {
  const part = model.parts.get(name);
  const rest = model.rest.get(name);
  if (!part || !rest) return null;
  part.position.copy(rest.position);
  part.scale.copy(rest.scale);
  part.quaternion.copy(rest.quaternion);
  if (axis && angle) part.quaternion.multiply(tmpQ.setFromAxisAngle(axis, angle));
  return part;
}

function eighth(beat: BeatInfo) {
  const index = Math.floor(beat.step / 2);
  return { index, phase: ((beat.step % 2) + beat.stepPhase) / 2 };
}

const ring = (seconds: number, frequency: number, decay: number) =>
  Math.sin(seconds * frequency) * Math.exp(-seconds * decay);

const animate: Partial<Record<SampleRole, Animator>> = {
  DRUMS(model, beat, now, amp, barSeconds) {
    const kick = beat.pulse * amp;
    const head = pose(model, 'KickHead');
    if (head) {
      head.scale.multiplyScalar(1 + kick * 0.015);
      head.position.z += kick * 0.05;
    }
    const { index, phase } = eighth(beat);
    const hit = (1 - phase) ** 4;
    for (const [name, which] of [['StickL', 0], ['StickR', 1]] as const) {
      const mine = index % 2 === which ? hit : 0;
      const idle = Math.sin(now / 700 + which * 2) * 0.025 * decorativeMotion();
      pose(model, name, X, (0.32 - mine * 0.32) * (0.3 + amp * 0.7) + idle);
    }
    const since = beat.barPhase * barSeconds;
    pose(model, 'Crash', X, ring(since, 16, 3.2) * 0.12 * amp + Math.sin(now / 900) * 0.01 * decorativeMotion());
  },
  BASS(model, beat, now, amp) {
    const push = beat.pulse * amp;
    for (const name of ['Cone1', 'Cone2', 'PedCone']) {
      const cone = pose(model, name);
      if (!cone) continue;
      cone.position.z += push * (name === 'PedCone' ? 0.035 : 0.06);
      cone.scale.multiplyScalar(1 + push * 0.018);
    }
    const strings = pose(model, 'Strings');
    if (strings) strings.position.x += Math.sin(now / 17) * push * .006;
    const meter = pose(model, 'Meter');
    if (meter) meter.scale.x = MathUtils.clamp(0.25 + push * 0.8 + Math.sin(now / 90) * 0.06 * amp, 0.12, 1);
  },
  MUSIC(model, beat, now, amp) {
    ['Key1', 'Key4', 'Key8', 'Key11'].forEach((name, i) => {
      const tap = Math.floor(beat.step / 2) % 4 === i ? beat.stepPulse : 0;
      pose(model, name, X, .075 * tap * amp);
    });
    for (const name of ['EyeL', 'EyeR']) {
      const eye = pose(model, name);
      if (eye) {
        eye.scale.y *= eyeOpenness(now, 1400);
        eye.position.x += Math.sin(now / 2300) * .025 * decorativeMotion();
      }
    }
    const pads = pose(model, 'Pads');
    if (pads) pads.position.y -= beat.stepPulse * 0.008 * amp;
  },
  TOPS(model, beat, now, amp, barSeconds) {
    const { index, phase } = eighth(beat);
    const open = index % 2 === 1 ? (1 - phase) ** 1.6 : 0;
    const hat = pose(model, 'HatTop');
    if (hat) hat.position.y += (open * 0.09 - beat.stepPulse * 0.012) * amp;
    const since = beat.beatPhase * (barSeconds / 4);
    pose(model, 'Ride', X, ring(since, 20, 5) * 0.07 * amp + Math.sin(now / 1100) * 0.012 * decorativeMotion());
    pose(model, 'Jingles', Y, Math.sin(now / 23) * 0.035 * beat.stepPulse * amp);
    const shake = Math.sin((beat.step + beat.stepPhase) * Math.PI) * 0.12 * amp + Math.sin(now / 1100) * 0.025 * decorativeMotion();
    pose(model, 'ShakerL', Z, shake);
    pose(model, 'ShakerR', Z, -shake * .85);
    ['Star1', 'Star2', 'Star3'].forEach((name, i) => {
      const star = pose(model, name, Y, Math.sin(now / (1400 + i * 300) + i) * .1 * decorativeMotion());
      if (!star) return;
      const twinkle = (beat.step + i * 3) % 8 === 0 ? beat.stepPulse : 0;
      star.scale.multiplyScalar(1 + twinkle * .025 * amp);
    });
  },
};

useGLTF.preload(STATIONS_FILE, DRACO_DECODER);
