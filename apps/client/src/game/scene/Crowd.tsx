import { useFrame, useLoader } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  BufferAttribute,
  DynamicDrawUsage,
  FileLoader,
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from 'three';
import { CROWD_FLOOR_Y, CROWD_RADIUS, theme } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { PERFORMANCE } from '../performance';
import { beatInfo, crowdCheer, danceSeconds, pressure, showEnergy, visualEpoch } from '../beat';
import { CROWD_FILE, RIG_HEIGHT, parseCrowd, type CrowdAsset } from '../crowdAsset';
import { NO_REFLECTION_LAYER } from '../layers';
import { CROWD_STYLE_CLIPS, crowdMoves } from '../danceStyle';

type Tier = { rows: number; seat: number; lodRows: [number, number]; sectors: number };
const TIERS: Record<typeof PERFORMANCE.tier, Tier> = {
  high: { rows: 12, seat: 1.0, lodRows: [2, 6], sectors: 8 },
  medium: { rows: 11, seat: 1.0, lodRows: [2, 5], sectors: 12 },
  low: { rows: 8, seat: 1.15, lodRows: [1, 3], sectors: 8 },
};
const LIGHT_LOD_ROWS: Record<typeof PERFORMANCE.tier, [number, number]> = {
  high: [0, 3],
  medium: [0, 2],
  low: [0, 1],
};
const TIER: Tier = PERFORMANCE.lightCrowd
  ? { ...TIERS[PERFORMANCE.tier], lodRows: LIGHT_LOD_ROWS[PERFORMANCE.tier] }
  : TIERS[PERFORMANCE.tier];

const ROW_DEPTH = 0.95;
const INNER = CROWD_RADIUS + 0.45;
const OUTER = INNER + TIER.rows * ROW_DEPTH;
const FIRST_STEP = 0.2;
const RISE_BACK = 0.72;
const RISE_FRONT = 0.16;
const SIZE = 0.5;
const DARK_ROW = 8;

const FRAMES_PER_BAR = 60;
const MAX_LAG = 0.02;
const BLEND_FRAMES = 10;
const FRAMES_PER_BEAT = FRAMES_PER_BAR / 4;
const RESHUFFLE = 0.12;
const OLA_LAP_BARS = 2;
const OLA_FROM = Math.PI * 0.5;
const OLA_REST_BARS = 16;

function frontness(angle: number) {
  const t = Math.min(1, Math.max(0, (Math.cos(angle) - 0.2) / 0.55));
  return t * t * (3 - 2 * t);
}

function riseAt(angle: number) {
  return RISE_BACK + (RISE_FRONT - RISE_BACK) * frontness(angle);
}

function terraceHeight(angle: number, row: number) {
  return FIRST_STEP + row * riseAt(angle);
}

type Seat = { x: number; y: number; z: number; yaw: number; scale: number; row: number; angle: number };

function seats(random: () => number): Seat[] {
  const out: Seat[] = [];
  for (let row = 0; row < TIER.rows; row += 1) {
    const radius = INNER + ROW_DEPTH * (row + 0.5);
    const count = Math.floor((Math.PI * 2 * radius) / TIER.seat);
    const step = (Math.PI * 2) / count;
    for (let k = 0; k < count; k += 1) {
      const angle = (k + (row % 2) * 0.5 + (random() - 0.5) * 0.35) * step;
      const r = radius + (random() - 0.5) * ROW_DEPTH * 0.3;
      out.push({
        x: Math.sin(angle) * r,
        y: terraceHeight(angle, row),
        z: Math.cos(angle) * r,
        yaw: angle + Math.PI + (random() - 0.5) * 0.5,
        scale: SIZE * (0.9 + random() * 0.2),
        row,
        angle,
      });
    }
  }
  return out;
}

function buildTerraces() {
  const SEGMENTS = 144;
  const WALL = 9;
  const quads = SEGMENTS * (TIER.rows * 2 + 1);
  const positions = new Float32Array(quads * 4 * 3);
  const colors = new Float32Array(quads * 4 * 3);
  const indices = new Uint16Array(quads * 6);
  const near = new Color('#161b2b');
  const far = new Color('#05060b');
  const tint = new Color();
  let quad = 0;
  let vertex = 0;
  const corner = (angle: number, radius: number, y: number) => {
    positions[vertex * 3] = Math.sin(angle) * radius;
    positions[vertex * 3 + 1] = y;
    positions[vertex * 3 + 2] = Math.cos(angle) * radius;
    colors[vertex * 3] = tint.r;
    colors[vertex * 3 + 1] = tint.g;
    colors[vertex * 3 + 2] = tint.b;
    vertex += 1;
  };
  const face = (
    a0: number, r0: number, y0: number, a1: number, r1: number, y1: number,
    a2: number, r2: number, y2: number, a3: number, r3: number, y3: number, shade: number,
  ) => {
    const base = vertex;
    tint.copy(near).lerp(far, Math.min(1, shade));
    corner(a0, r0, y0);
    corner(a1, r1, y1);
    corner(a2, r2, y2);
    corner(a3, r3, y3);
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], quad * 6);
    quad += 1;
  };
  for (let i = 0; i < SEGMENTS; i += 1) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    for (let row = 0; row < TIER.rows; row += 1) {
      const r0 = INNER + row * ROW_DEPTH;
      const r1 = r0 + ROW_DEPTH;
      const h0 = terraceHeight(a0, row);
      const h1 = terraceHeight(a1, row);
      const shade = row / TIER.rows;
      face(a0, r0, h0, a0, r1, h0, a1, r1, h1, a1, r0, h1, shade);
      const below0 = row === 0 ? 0 : terraceHeight(a0, row - 1);
      const below1 = row === 0 ? 0 : terraceHeight(a1, row - 1);
      face(a0, r0, below0, a0, r0, h0, a1, r0, h1, a1, r0, below1, shade * 0.9);
    }
    const top0 = terraceHeight(a0, TIER.rows - 1);
    const top1 = terraceHeight(a1, TIER.rows - 1);
    const wall0 = WALL * (1 - frontness(a0));
    const wall1 = WALL * (1 - frontness(a1));
    face(a0, OUTER, top0, a0, OUTER, top0 + wall0, a1, OUTER, top1 + wall1, a1, OUTER, top1, 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vertexShader = `
  #include <fog_pars_vertex>
  uniform highp sampler2D uBones;
  uniform float uBar;
  uniform float uHit;
  attribute vec4 aNormal;
  attribute vec4 aSkin;
  attribute vec4 iClip;
  attribute vec4 iPrev;
  attribute vec4 iLook;
  attribute vec3 iColorA;
  attribute vec3 iColorB;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vEye;
  varying float vSeed;
  varying float vFar;
  varying vec3 vColorA;
  varying vec3 vColorB;

  void boneRows(int bone, int row, out vec4 r0, out vec4 r1, out vec4 r2) {
    ivec2 at = ivec2(bone * 3, row);
    r0 = texelFetch(uBones, at, 0);
    r1 = texelFetch(uBones, at + ivec2(1, 0), 0);
    r2 = texelFetch(uBones, at + ivec2(2, 0), 0);
  }

  void boneAt(int bone, int row0, int row1, float t, out vec4 m0, out vec4 m1, out vec4 m2) {
    vec4 a0, a1, a2, b0, b1, b2;
    boneRows(bone, row0, a0, a1, a2);
    boneRows(bone, row1, b0, b1, b2);
    m0 = mix(a0, b0, t);
    m1 = mix(a1, b1, t);
    m2 = mix(a2, b2, t);
  }

  void pose(vec4 clip, float bar, int bone0, int bone1, float weight, out vec4 m0, out vec4 m1, out vec4 m2) {
    float frames = abs(clip.y);
    float f = (bar - clip.z) * ${FRAMES_PER_BAR}.0;
    f = clip.y > 0.0 ? mod(f, frames) : clamp(f, 0.0, frames);
    float f0 = floor(f);
    float t = f - f0;
    int row0 = int(clip.x + f0);
    int row1 = int(clip.x + min(f0 + 1.0, frames));
    boneAt(bone0, row0, row1, t, m0, m1, m2);
    if (bone1 != bone0 && weight < 0.999) {
      vec4 n0, n1, n2;
      boneAt(bone1, row0, row1, t, n0, n1, n2);
      m0 = m0 * weight + n0 * (1.0 - weight);
      m1 = m1 * weight + n1 * (1.0 - weight);
      m2 = m2 * weight + n2 * (1.0 - weight);
    }
  }

  void main() {
    float bar = uBar - iLook.y;
    int bone0 = int(aSkin.x);
    int bone1 = int(aSkin.y);
    float weight = aSkin.z / 255.0;
    vec4 m0, m1, m2;
    pose(iClip, bar, bone0, bone1, weight, m0, m1, m2);
    float into = smoothstep(0.0, ${BLEND_FRAMES}.0, (bar - iClip.w) * ${FRAMES_PER_BAR}.0);
    if (into < 1.0) {
      vec4 p0, p1, p2;
      pose(iPrev, bar, bone0, bone1, weight, p0, p1, p2);
      m0 = mix(p0, m0, into);
      m1 = mix(p1, m1, into);
      m2 = mix(p2, m2, into);
    }
    vec4 bind = vec4(position, 1.0);
    vec3 skinned = vec3(dot(m0, bind), dot(m1, bind), dot(m2, bind));
    float hit = uHit * (0.4 + iLook.z);
    skinned.y *= 1.0 - 0.08 * hit;
    skinned.xz *= 1.0 + 0.04 * hit;
    vec3 normal = aNormal.xyz;
    vec3 skinnedNormal = vec3(dot(m0.xyz, normal), dot(m1.xyz, normal), dot(m2.xyz, normal));

    vec4 world = modelMatrix * instanceMatrix * vec4(skinned, 1.0);
    vec4 mvPosition = viewMatrix * world;
    vNormal = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * skinnedNormal);
    vView = -mvPosition.xyz;
    vWorld = world.xyz;
    vHeight = position.y / ${RIG_HEIGHT.toFixed(2)};
    vEye = aSkin.w;
    vSeed = iLook.x;
    vFar = iLook.w;
    vColorA = iColorA;
    vColorB = iColorB;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = `
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uEnergy;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vEye;
  varying float vSeed;
  varying float vFar;
  varying vec3 vColorA;
  varying vec3 vColorB;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    float h = clamp(vHeight, 0.0, 1.0);
    vec3 color = mix(vColorA * 0.7, vColorB, smoothstep(0.12, 0.95, h));

    float facing = dot(n, normalize(vec3(0.2, 0.75, 0.6))) * 0.5 + 0.5;
    color *= 0.62 + 0.38 * smoothstep(0.3, 0.62, facing);

    float vivid = 0.3 + 0.7 * uEnergy;
    float grey = dot(color, vec3(0.3, 0.59, 0.11));
    color = mix(vec3(grey), color, vivid) * (0.3 + 0.5 * vivid);

    float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.4);
    vec3 glow = mix(vColorB, vec3(1.0), 0.3);
    color += glow * rim * (0.16 + 0.44 * uEnergy);

    float sheen = sin(h * 10.0 - uTime * 2.6 + vSeed * 6.2832) * 0.5 + 0.5;
    color += glow * smoothstep(0.9, 1.0, sheen) * (0.08 + 0.4 * uEnergy);

    float spark = hash(floor(vWorld * 7.0) + floor(uTime * 7.0));
    color += vec3(1.0) * step(0.993, spark) * uEnergy * (0.6 + uPulse);

    color = mix(color, vec3(0.03, 0.02, 0.06) + glow * rim * 0.25, vEye);

    float depth = smoothstep(0.12, 1.0, vFar);
    color = mix(color, vec3(dot(color, vec3(0.3, 0.59, 0.11))), depth * 0.45) * mix(1.0, 0.07, depth);

    gl_FragColor = vec4(color, 1.0);
    #include <fog_fragment>
  }
`;

type Clips = {
  row: Int32Array;
  frames: Int32Array;
  loop: Uint8Array;
  bars: Float32Array;
  find: (name: string) => number;
  base: number;
  transitions: number[];
  cheer: number;
  clap: number;
  wave: number;
  point: number;
  boo: number;
  shrug: number;
  ola: number;
};

function clipIndex(asset: CrowdAsset): Clips {
  const find = (name: string) => {
    const index = asset.clips.findIndex((clip) => clip.name === name);
    if (index < 0) throw new Error(`crowd.bin has no ${name}`);
    return index;
  };
  for (const name of CROWD_STYLE_CLIPS) find(name);
  return {
    row: Int32Array.from(asset.clips, (clip) => clip.row),
    frames: Int32Array.from(asset.clips, (clip) => (clip.loop ? clip.frames : -clip.frames)),
    loop: Uint8Array.from(asset.clips, (clip) => (clip.loop ? 1 : 0)),
    bars: Float32Array.from(asset.clips, (clip) => Math.max(1, Math.round(clip.frames / FRAMES_PER_BAR))),
    find,
    base: find('Crowd_Base'),
    transitions: [0, 1, 2, 3, 4].map((from) => find(`Crowd_T${from}to${from + 1}`)),
    cheer: find('Crowd_Cheer'),
    clap: find('Crowd_Clap'),
    wave: find('Crowd_Wave'),
    point: find('Crowd_Point'),
    boo: find('Crowd_Boo'),
    shrug: find('Crowd_Shrug'),
    ola: find('Crowd_Ola'),
  };
}

type Menu = { clips: number[]; totals: number[] }[];
function menuFor(themeId: string, clips: Clips): Menu {
  return crowdMoves(themeId).map((moves) => {
    let sum = 0;
    return { clips: moves.map(([name]) => clips.find(name)), totals: moves.map(([, weight]) => (sum += weight)) };
  });
}

function pick(entry: Menu[number], choice: number) {
  const at = choice * entry.totals[entry.totals.length - 1]!;
  const index = entry.totals.findIndex((total) => at < total);
  return entry.clips[index < 0 ? entry.clips.length - 1 : index]!;
}

function levelFor(energy: number, keen: number) {
  const drive = Math.min(0.999, Math.max(0, 0.06 + energy * 1.2 + (keen - 0.5) * 0.45));
  return Math.floor(drive * 6);
}

function barsNow(state: Parameters<typeof danceSeconds>[0], now: number) {
  const epoch = visualEpoch(state);
  if (epoch === null || now < epoch) return performance.now() / 2000;
  return danceSeconds(state, now) / 2;
}

const PALETTE_STEPS = 6;
const scratch = new Color();
const hsl = { h: 0, s: 0, l: 0 };

function palette(accent: string, secondary: string): Color[] {
  const out: Color[] = [];
  for (const [source, shifts] of [[accent, [0, 0.11, -0.11]], [secondary, [0, 0.11, -0.11]]] as const) {
    for (const shift of shifts) {
      scratch.set(source).getHSL(hsl);
      out.push(new Color().setHSL((hsl.h + shift + 1) % 1, Math.max(0.85, hsl.s), 0.5));
    }
  }
  return [out[0]!, out[3]!, out[1]!, out[4]!, out[2]!, out[5]!];
}

export function Crowd() {
  const terraces = useMemo(() => buildTerraces(), []);
  useEffect(() => () => terraces.dispose(), [terraces]);
  return (
    <group position={[0, CROWD_FLOOR_Y, 0]}>
      <mesh geometry={terraces} ref={(node) => { node?.layers.set(NO_REFLECTION_LAYER); }}>
        <meshStandardMaterial vertexColors roughness={0.9} metalness={0.06} side={DoubleSide} envMapIntensity={0.3} />
      </mesh>
      <Suspense fallback={null}>
        <Audience />
      </Suspense>
    </group>
  );
}

type Group = {
  mesh: InstancedMesh;
  members: number[];
  clip: InstancedBufferAttribute;
  prev: InstancedBufferAttribute;
  colorA: InstancedBufferAttribute;
  colorB: InstancedBufferAttribute;
};

function Audience() {
  const state = useGameStateWhen((room) => room.themeId);
  const runtime = useGameRuntime();
  const vibe = theme(state.themeId);
  const buffer = useLoader(FileLoader, CROWD_FILE, (loader) => loader.setResponseType('arraybuffer')) as ArrayBuffer;
  const asset = useMemo(() => parseCrowd(buffer), [buffer]);
  const clips = useMemo(() => clipIndex(asset), [asset]);

  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uBones: { value: null },
        uBar: { value: 0 },
        uHit: { value: 0 },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uPulse: { value: 0 },
      },
    ]),
  }), []);
  material.uniforms.uBones!.value = asset.bones;

  const people = useMemo(() => {
    const random = mulberry(0x5eed);
    const list = seats(random);
    return {
      seats: list,
      keen: Float32Array.from(list, () => random() ** 0.8),
      choice: Float32Array.from(list, () => random()),
      hue: Uint8Array.from(list, () => Math.floor(random() * PALETTE_STEPS)),
      seed: Float32Array.from(list, () => random()),
      lag: Float32Array.from(list, () => (random() + random() - 1) * MAX_LAG),
    };
  }, []);

  const groups = useMemo(() => {
    const dummy = new Object3D();
    const buckets = new Map<string, number[]>();
    people.seats.forEach((seat, index) => {
      const sector = Math.floor((((seat.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * TIER.sectors) % TIER.sectors;
      const lod = seat.row < TIER.lodRows[0] ? 0 : seat.row < TIER.lodRows[1] ? 1 : 2;
      const key = `${sector}:${lod}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(index);
      buckets.set(key, bucket);
    });
    const list: Group[] = [];
    for (const [key, members] of buckets) {
      const lod = Number(key.split(':')[1]);
      const geometry = asset.lods[lod]!.clone();
      const clip = new InstancedBufferAttribute(new Float32Array(members.length * 4), 4);
      clip.setUsage(DynamicDrawUsage);
      const prev = new InstancedBufferAttribute(new Float32Array(members.length * 4), 4);
      prev.setUsage(DynamicDrawUsage);
      const look = new InstancedBufferAttribute(new Float32Array(members.length * 4), 4);
      const colorA = new InstancedBufferAttribute(new Float32Array(members.length * 3), 3);
      const colorB = new InstancedBufferAttribute(new Float32Array(members.length * 3), 3);
      geometry.setAttribute('iClip', clip);
      geometry.setAttribute('iPrev', prev);
      geometry.setAttribute('iLook', look);
      geometry.setAttribute('iColorA', colorA);
      geometry.setAttribute('iColorB', colorB);
      const mesh = new InstancedMesh(geometry, material, members.length);
      members.forEach((index, slot) => {
        const seat = people.seats[index]!;
        dummy.position.set(seat.x, seat.y, seat.z);
        dummy.rotation.set(0, seat.yaw, 0);
        dummy.scale.setScalar(seat.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(slot, dummy.matrix);
        clip.setXYZW(slot, clips.row[clips.base]!, clips.frames[clips.base]!, -1e4, -1e4);
        prev.setXYZW(slot, clips.row[clips.base]!, clips.frames[clips.base]!, -1e4, 0);
        look.setXYZW(slot, people.seed[index]!, people.lag[index]!, people.keen[index]!, Math.min(1, seat.row / DARK_ROW));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.layers.set(NO_REFLECTION_LAYER);
      mesh.computeBoundingSphere();
      list.push({ mesh, members, clip, prev, colorA, colorB });
    }
    return list;
  }, [asset, clips, material, people]);

  useEffect(() => () => {
    for (const group of groups) {
      group.mesh.geometry.dispose();
      group.mesh.dispose();
    }
  }, [groups]);

  useEffect(() => {
    const colors = palette(vibe.look.accent, vibe.look.secondary);
    for (const group of groups) {
      group.members.forEach((index, slot) => {
        const hue = people.hue[index]!;
        const feet = colors[hue]!;
        const tips = colors[(hue + 1) % PALETTE_STEPS]!;
        group.colorA.setXYZ(slot, feet.r, feet.g, feet.b);
        group.colorB.setXYZ(slot, tips.r, tips.g, tips.b);
      });
      group.colorA.needsUpdate = true;
      group.colorB.needsUpdate = true;
    }
  }, [groups, people, vibe.look.accent, vibe.look.secondary]);

  const plan = useMemo(() => {
    const count = people.seats.length;
    const where = new Int32Array(count * 2);
    groups.forEach((group, g) => group.members.forEach((index, slot) => { where[index * 2] = g; where[index * 2 + 1] = slot; }));
    return {
      where,
      level: new Int8Array(count),
      ends: new Float64Array(count).fill(-Infinity),
      clip: new Int16Array(count).fill(clips.base),
      origin: new Float64Array(count).fill(-1e4),
      olaDelay: Float32Array.from(people.seats, (seat) => {
        const turn = Math.PI * 2;
        return ((((seat.angle - OLA_FROM) % turn) + turn) % turn) / turn * OLA_LAP_BARS;
      }),
      olaDone: new Uint8Array(count),
      dirty: new Uint8Array(groups.length),
      random: mulberry(0xc0ffee),
      lastBar: -Infinity,
      heat: 0,
      cheerUntil: -Infinity,
      cheering: false,
      olaAt: -Infinity,
      lastOla: -Infinity,
    };
  }, [clips, groups, people]);

  const menu = useMemo(() => menuFor(vibe.id, clips), [clips, vibe.id]);

  useFrame(({ clock }) => {
    const state = runtime.getState();
    const now = runtime.now();
    const bar = barsNow(state, now);
    const energy = showEnergy(state, now);
    const cheer = crowdCheer(state, now);
    const restless = pressure(state, now);
    const beat = beatInfo(state, now);

    material.uniforms.uBar!.value = bar;
    material.uniforms.uTime!.value = clock.elapsedTime;
    material.uniforms.uEnergy!.value = energy;
    material.uniforms.uPulse!.value = beat.pulse;
    const heat = Math.min(1, Math.max(0, (energy - 0.15) / 0.7));
    plan.heat += (heat - plan.heat) * 0.05;
    material.uniforms.uHit!.value = beat.pulse * plan.heat;

    if (bar < plan.lastBar - 0.01 || bar > plan.lastBar + 4) {
      plan.ends.fill(-Infinity);
      plan.olaAt = -Infinity;
      plan.lastOla = -Infinity;
    }
    plan.lastBar = bar;

    const rising = cheer > 0.35 && !plan.cheering;
    if (rising) plan.cheerUntil = Math.floor(bar) + 3;
    if (rising && cheer > 0.6 && bar - plan.lastOla > OLA_REST_BARS) {
      plan.olaAt = bar + 0.25;
      plan.lastOla = bar;
      plan.olaDone.fill(0);
    }
    plan.cheering = cheer > 0.35;
    const olaLive = bar < plan.olaAt + OLA_LAP_BARS + 0.05;

    const { random } = plan;
    const set = (i: number, next: number, origin: number, at: number) => {
      const g = plan.where[i * 2]!;
      const slot = plan.where[i * 2 + 1]!;
      const group = groups[g]!;
      const was = plan.clip[i]!;
      group.prev.setXYZW(slot, clips.row[was]!, clips.frames[was]!, plan.origin[i]!, 0);
      group.clip.setXYZW(slot, clips.row[next]!, clips.frames[next]!, origin, at);
      plan.clip[i] = next;
      plan.origin[i] = origin;
      plan.dirty[g] = 1;
    };

    for (let i = 0; i < people.seats.length; i += 1) {
      const own = bar - people.lag[i]!;
      if (olaLive && !plan.olaDone[i]) {
        const at = plan.olaAt + plan.olaDelay[i]!;
        if (own >= at) {
          plan.olaDone[i] = 1;
          set(i, clips.ola, at, at);
          plan.ends[i] = at + clips.bars[clips.ola]!;
          continue;
        }
      }
      if (own < plan.ends[i]!) continue;
      const start = plan.ends[i]! > own - 1 ? plan.ends[i]! : Math.floor(own);
      const keen = people.keen[i]!;
      const current = plan.level[i]!;
      const target = levelFor(energy, keen);
      let next: number;
      if (start < plan.cheerUntil && random() < 0.45 + keen * 0.5) {
        next = random() < 0.8 ? clips.cheer : random() < 0.5 ? clips.wave : clips.point;
      } else if (restless > 0.45 && random() < restless * (0.25 + keen * 0.4)) {
        next = energy < 0.3 && restless > 0.6 && random() < 0.5 ? (random() < 0.5 ? clips.boo : clips.shrug) : clips.clap;
      } else if (target > current) {
        next = clips.transitions[current]!;
        plan.level[i] = current + 1;
      } else {
        plan.level[i] = target;
        if (random() < RESHUFFLE) people.choice[i] = random();
        next = target >= 2 && random() < 0.05 ? (random() < 0.5 ? clips.wave : clips.point) : pick(menu[target]!, people.choice[i]!);
      }
      const bar0 = Math.floor(start + 1e-6);
      if (!clips.loop[next]) {
        plan.ends[i] = Math.ceil(start + clips.bars[next]! - 1e-6);
        set(i, next, start, start);
        continue;
      }
      plan.ends[i] = bar0 + clips.bars[next]!;
      if (next === plan.clip[i]) continue;
      const loose = plan.level[i]! <= 2 && start >= plan.cheerUntil;
      const beats = Math.abs(clips.frames[next]!) / FRAMES_PER_BEAT;
      set(i, next, bar0 - (loose ? Math.floor(random() * beats) / 4 : 0), start);
    }
    for (let g = 0; g < groups.length; g += 1) {
      if (!plan.dirty[g]) continue;
      plan.dirty[g] = 0;
      groups[g]!.clip.needsUpdate = true;
      groups[g]!.prev.needsUpdate = true;
    }
  });

  return (
    <>
      {groups.map((group, index) => <primitive key={index} object={group.mesh} />)}
    </>
  );
}
