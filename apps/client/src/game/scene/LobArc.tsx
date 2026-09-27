import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, MathUtils, Mesh, PlaneGeometry, Plane, Raycaster, ShaderMaterial,
  Vector2, Vector3,
} from 'three';
import {
  BLOCK_REST_Y, LOB_POWER_MAX, LOB_POWER_MIN, distanceXZ, isOnDeck, machineTakes, machineUnder, plotLob, type Vec3,
} from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { aimAt, lobOrigin, mousePointer, useAimStore } from '../aim';
import { beatInfo } from '../beat';
import { NO_REFLECTION_LAYER } from '../layers';
import { easeOutBack } from '../stage';

const FINE_POINTS = 96;
const FREE = new Color('#ffffff');
const CATCH = new Color('#73ffd0');

type LobPreview = { arc: Vec3[]; landing: Vec3; caught: boolean };

export function LobArc() {
  const runtime = useGameRuntime();
  const state = useGameStateWhen((room) => {
    const me = room.players[runtime.playerId];
    const block = me?.heldBlockId ? room.blocks[me.heldBlockId] : null;
    return block ? [block.id, block.role, block.status, block.fx, me!.position.x, me!.position.z,
      Object.values(room.stations).map((station) => station.busyUntil)] : null;
  });
  const aim = useAimStore();
  const player = state.players[runtime.playerId];
  const held = player?.heldBlockId ? state.blocks[player.heldBlockId] : null;
  const marks = useMemo(() => new AimMarks(), []);
  useEffect(() => () => marks.dispose(), [marks]);

  const plot = useMemo((): LobPreview | null => {
    if (!aim.aiming || !player || !held) return null;
    const origin = lobOrigin(player.position, aim.heading);
    const lob = plotLob(origin, aim.heading, aim.power, FINE_POINTS);
    const fine = lob.arc;
    for (let i = 1; i < fine.length; i += 1) {
      const point = fine[i]!;
      if (point.y >= fine[i - 1]!.y) continue;
      const machine = machineUnder(point);
      if (!machine) continue;
      return { arc: fine.slice(0, i + 1), landing: point, caught: machineTakes(state, machine.id, held.fx, runtime.now()).ok };
    }
    return { arc: fine, landing: lob.landing, caught: isOnDeck(lob.landing) };
  }, [aim.aiming, aim.heading.x, aim.heading.z, aim.power, held?.id, held?.fx, player?.position.x, player?.position.z, state]);

  useLayoutEffect(() => marks.aim(plot), [marks, plot]);

  useFrame((three, delta) => {
    const room = runtime.getState();
    marks.update(delta, three.clock.elapsedTime, beatInfo(room, runtime.now()));
  });

  return (
    <group name="lob-arc">
      <primitive object={marks.ribbon} />
      <primitive object={marks.target} />
    </group>
  );
}

const RIBBON_HALF_WIDTH = 0.2;
const SPARK_SPACING = 0.9;
const SPARKS_PER_BEAT = 2;
const DRAW_SECONDS = 0.2;
const FADE_SECONDS = 0.18;
const TARGET_RADIUS = 0.8;

const ribbonVertex = `
attribute vec3 aTangent;
attribute float aDist;
attribute float aSide;
uniform float uWidth;
uniform float uPulse;
varying float vSide;
varying float vDist;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vec3 along = (modelViewMatrix * vec4(aTangent, 0.0)).xyz;
  vec3 across = cross(along, -view.xyz);
  float size = length(across);
  across = size > 1e-5 ? across / size : vec3(1.0, 0.0, 0.0);
  float taper = mix(0.4, 1.0, smoothstep(0.0, 1.4, aDist));
  view.xyz += across * aSide * uWidth * taper * (1.0 + uPulse * 0.22);
  vSide = aSide;
  vDist = aDist;
  gl_Position = projectionMatrix * view;
}
`;

const ribbonFragment = `
uniform vec3 uColor;
uniform float uLength;
uniform float uReveal;
uniform float uFlow;
uniform float uSpacing;
uniform float uOpacity;
varying float vSide;
varying float vDist;
void main() {
  if (vDist > uReveal) discard;
  float edge = abs(vSide);
  float core = exp(-edge * edge * 5.0);
  float halo = exp(-edge * edge * 3.0) * (1.0 - smoothstep(0.7, 1.0, edge));
  float run = vDist / uSpacing - uFlow;
  float p = fract(run);
  float soft = max(0.22, fwidth(run) * 2.0);
  float spark = smoothstep(0.15, 1.0 - soft, p) * (1.0 - smoothstep(1.0 - soft, 1.0, p));
  spark = spark * spark * (3.0 - 2.0 * spark);
  float ends = smoothstep(0.0, 0.8, vDist) * (1.0 - 0.6 * smoothstep(uLength - 0.3, uLength, vDist));
  float head = 1.0 - smoothstep(uReveal - 0.35, uReveal, vDist) * step(uReveal, uLength);
  float alpha = (halo * (0.12 + spark * 0.06) + core * (0.3 + spark * 0.16)) * ends * head * uOpacity;
  vec3 color = uColor * (0.9 + spark * 0.12);
  gl_FragColor = vec4(color, alpha);
}
`;

const targetVertex = `
varying vec2 vPoint;
void main() {
  vPoint = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const targetFragment = `
uniform vec3 uColor;
uniform float uTime;
uniform float uBeat;
uniform float uPulse;
uniform float uCaught;
uniform float uOpacity;
varying vec2 vPoint;
float band(float r, float at, float width, float aa) {
  return 1.0 - smoothstep(width, width + aa, abs(r - at));
}
void main() {
  float r = length(vPoint);
  if (r > 1.0) discard;
  float aa = fwidth(r) * 1.5 + 0.02;
  float turn = atan(vPoint.y, vPoint.x) / 6.2831853;
  float fill = (1.0 - smoothstep(0.62, 0.62 + aa, r)) * mix(0.12, 0.22, uCaught);
  float ring = band(r, 0.6, 0.02 + uPulse * 0.012, aa);
  float dash = fract(turn * 12.0 + uTime * mix(0.18, -0.45, uCaught));
  float ticks = band(r, 0.84, 0.008, aa) * smoothstep(0.02, 0.16, dash) * (1.0 - smoothstep(0.56, 0.7, dash));
  float out_ = band(r, mix(0.2, 1.0, uBeat), 0.018, aa) * (1.0 - uBeat);
  float in_ = band(r, mix(1.0, 0.16, uBeat), 0.018, aa) * (1.0 - uBeat) * smoothstep(0.0, 0.2, uBeat);
  float ripple = mix(out_, in_, uCaught) * 0.75;
  float dot_ = 1.0 - smoothstep(0.11 + uPulse * 0.04, 0.11 + uPulse * 0.04 + aa, r);
  float alpha = max(max(fill, ring * 0.85), max(ticks * 0.6, max(ripple, dot_ * 0.8))) * uOpacity;
  float bright = 0.9 + (ring + dot_) * uCaught * 0.5;
  gl_FragColor = vec4(uColor * bright, alpha);
}
`;

class AimMarks {
  readonly ribbon: Mesh<BufferGeometry, ShaderMaterial>;
  readonly target: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly positions: BufferAttribute;
  private readonly tangents: BufferAttribute;
  private readonly dists: BufferAttribute;
  private readonly color = FREE.clone();
  private aiming = false;
  private caught = 0;
  private caughtWanted = 0;
  private drawn = 0;
  private opacity = 0;
  private length = 0;

  constructor() {
    const vertices = FINE_POINTS * 2;
    const geometry = new BufferGeometry();
    this.positions = new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(DynamicDrawUsage);
    this.tangents = new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(DynamicDrawUsage);
    this.dists = new BufferAttribute(new Float32Array(vertices), 1).setUsage(DynamicDrawUsage);
    const sides = new Float32Array(vertices);
    for (let i = 0; i < vertices; i += 1) sides[i] = i % 2 === 0 ? -1 : 1;
    const index: number[] = [];
    for (let i = 0; i < FINE_POINTS - 1; i += 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('aTangent', this.tangents);
    geometry.setAttribute('aDist', this.dists);
    geometry.setAttribute('aSide', new BufferAttribute(sides, 1));
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);

    this.ribbon = new Mesh(geometry, new ShaderMaterial({
      vertexShader: ribbonVertex,
      fragmentShader: ribbonFragment,
      uniforms: {
        uColor: { value: this.color },
        uWidth: { value: RIBBON_HALF_WIDTH },
        uPulse: { value: 0 },
        uLength: { value: 0 },
        uReveal: { value: 0 },
        uFlow: { value: 0 },
        uSpacing: { value: SPARK_SPACING },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    }));

    this.target = new Mesh(new PlaneGeometry(TARGET_RADIUS * 2, TARGET_RADIUS * 2).rotateX(-Math.PI / 2), new ShaderMaterial({
      vertexShader: targetVertex,
      fragmentShader: targetFragment,
      uniforms: {
        uColor: { value: this.color },
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uPulse: { value: 0 },
        uCaught: { value: 0 },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    }));

    for (const mesh of [this.ribbon, this.target]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.visible = false;
      mesh.layers.set(NO_REFLECTION_LAYER);
    }
  }

  aim(plot: LobPreview | null) {
    if (!plot || plot.arc.length < 2) {
      this.aiming = false;
      return;
    }
    if (!this.aiming && this.opacity <= 0) this.drawn = 0;
    this.aiming = true;
    this.caughtWanted = plot.caught ? 1 : 0;

    const points = plot.arc;
    const count = Math.min(points.length, FINE_POINTS);
    let dist = 0;
    for (let i = 0; i < count; i += 1) {
      const point = points[i]!;
      const from = points[Math.max(0, i - 1)]!;
      const to = points[Math.min(count - 1, i + 1)]!;
      if (i > 0) dist += Math.hypot(point.x - from.x, point.y - from.y, point.z - from.z);
      const tx = to.x - from.x;
      const ty = to.y - from.y;
      const tz = to.z - from.z;
      for (let side = 0; side < 2; side += 1) {
        const v = i * 2 + side;
        this.positions.setXYZ(v, point.x, point.y, point.z);
        this.tangents.setXYZ(v, tx, ty, tz);
        this.dists.setX(v, dist);
      }
    }
    this.length = dist;
    this.positions.needsUpdate = true;
    this.tangents.needsUpdate = true;
    this.dists.needsUpdate = true;
    this.ribbon.geometry.setDrawRange(0, (count - 1) * 6);
    this.target.position.set(plot.landing.x, Math.max(0.055, plot.landing.y), plot.landing.z);
  }

  update(delta: number, seconds: number, beat: { beat: number; beatPhase: number; pulse: number }) {
    const step = Math.min(delta, 0.1);
    this.opacity = this.aiming ? Math.min(1, this.opacity + step / 0.08) : Math.max(0, this.opacity - step / FADE_SECONDS);
    if (this.opacity <= 0) {
      this.ribbon.visible = false;
      this.target.visible = false;
      return;
    }
    if (this.aiming) this.drawn = Math.min(1, this.drawn + step / DRAW_SECONDS);
    this.caught += (this.caughtWanted - this.caught) * (1 - Math.exp(-step * 18));
    this.color.copy(FREE).lerp(CATCH, this.caught);

    const music = beat.beat > 0 || beat.beatPhase > 0;
    const beats = music ? beat.beat + beat.beatPhase : seconds * 2;
    const phase = beats % 1;
    const pulse = music ? beat.pulse : (1 - phase) ** 2.6;

    const ribbon = this.ribbon.material.uniforms;
    ribbon.uLength!.value = this.length;
    ribbon.uReveal!.value = MathUtils.smoothstep(this.drawn, 0, 1) * this.length + (this.drawn >= 1 ? 1 : 0);
    ribbon.uFlow!.value = beats * SPARKS_PER_BEAT;
    ribbon.uPulse!.value = pulse * this.caught;
    ribbon.uOpacity!.value = this.opacity;
    this.ribbon.visible = true;

    const landed = MathUtils.clamp((this.drawn - 0.6) / 0.4, 0, 1);
    const target = this.target.material.uniforms;
    target.uTime!.value = seconds;
    target.uBeat!.value = phase;
    target.uPulse!.value = pulse;
    target.uCaught!.value = this.caught;
    target.uOpacity!.value = this.opacity * Math.min(1, landed * 2);
    this.target.scale.setScalar(Math.max(0.001, easeOutBack(landed, 2.2)) * (this.aiming ? 1 : 0.85 + 0.15 * this.opacity));
    this.target.visible = landed > 0;
  }

  dispose() {
    this.ribbon.geometry.dispose();
    this.ribbon.material.dispose();
    this.target.geometry.dispose();
    this.target.material.dispose();
  }
}

const ray = new Raycaster();
const ndc = new Vector2();
const hit = new Vector3();
const landingPlane = new Plane(new Vector3(0, 1, 0), -BLOCK_REST_Y);
const MOUSE_DEADZONE = 0.3;

export function MouseAim() {
  const runtime = useGameRuntime();

  useEffect(() => {
    const track = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      mousePointer.seen = true;
      mousePointer.x = event.clientX;
      mousePointer.y = event.clientY;
    };
    window.addEventListener('pointermove', track, { passive: true });
    window.addEventListener('pointerdown', track, { passive: true });
    return () => {
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerdown', track);
    };
  }, []);

  useFrame(({ camera, size }) => {
    const aim = useAimStore.getState();
    if (!aim.aiming || !aim.mouse || !mousePointer.seen) return;
    const player = runtime.getState().players[runtime.playerId];
    if (!player) return;
    ndc.set(((mousePointer.x - size.left) / size.width) * 2 - 1, -((mousePointer.y - size.top) / size.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(landingPlane, hit)) return;
    const dx = hit.x - player.position.x;
    const dz = hit.z - player.position.z;
    const reach = Math.hypot(dx, dz);
    if (reach < MOUSE_DEADZONE) return;
    const heading = { x: dx / reach, y: 0, z: dz / reach };
    const power = powerToReach(player.position, heading, reach);
    if (Math.abs(heading.x - aim.heading.x) + Math.abs(heading.z - aim.heading.z) < 0.004 && Math.abs(power - aim.power) < 0.02) return;
    aimAt(heading, power, true);
  });

  return null;
}

function powerToReach(from: Vec3, heading: Vec3, reach: number) {
  const origin = lobOrigin(from, heading);
  let low = LOB_POWER_MIN;
  let high = LOB_POWER_MAX;
  for (let i = 0; i < 12; i += 1) {
    const mid = (low + high) / 2;
    if (distanceXZ(from, plotLob(origin, heading, mid, 2).landing) < reach) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
