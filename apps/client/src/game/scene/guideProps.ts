import {
  DynamicDrawUsage,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
  type Camera,
} from 'three';
import { NO_REFLECTION_LAYER } from '../layers';
import { alongRoute, routeLength, type FloorPoint } from '../guidePath';
import { easeOutBack } from '../stage';

export type Word = { key: string; text: string; chip: string | null; x: number; y: number; z: number; size?: number };

export type WordView = { camera: Camera; width: number; height: number; host: HTMLElement | null };

const PILL_HEIGHT = 0.86;
const PILL_PX = 84;
const APPEAR_SECONDS = 0.42;
const LEAVE_SECONDS = 0.2;

const anchor = new Vector3();
const above = new Vector3();
const cameraUp = new Vector3();

export class FloatingWord {
  private element: HTMLDivElement | null = null;
  private text: HTMLElement | null = null;
  private chip: HTMLElement | null = null;
  private key: string | null = null;
  private shown = 0;
  private leaving = false;
  private size = 1;
  private readonly at = new Vector3();
  private readonly phase = Math.random() * Math.PI * 2;
  private readonly pill: number;

  constructor(pill = PILL_HEIGHT) {
    this.pill = pill;
  }

  get showing() {
    return this.key !== null;
  }

  clear() {
    this.key = null;
    this.shown = 0;
    if (this.element) this.element.style.display = 'none';
  }

  dispose() {
    this.element?.remove();
    this.element = null;
  }

  private mount(host: HTMLElement) {
    if (this.element?.parentElement === host) return this.element;
    this.element?.remove();
    const element = document.createElement('div');
    element.className = 'world-word';
    element.setAttribute('aria-hidden', 'true');
    element.style.display = 'none';
    this.text = document.createElement('b');
    this.chip = document.createElement('i');
    element.append(this.text, this.chip);
    host.append(element);
    this.element = element;
    return element;
  }

  update(want: Word | null, accent: string, delta: number, view: WordView, seconds: number, keepIn: { x: number; top: number } | null = null) {
    const step = Math.min(delta, 0.1);
    if (this.key !== null && want?.key !== this.key) {
      this.leaving = true;
      this.shown = Math.max(0, this.shown - step / LEAVE_SECONDS);
      if (this.shown <= 0) this.key = null;
    }
    if (this.key === null && want && view.host) {
      this.mount(view.host);
      this.text!.textContent = want.text;
      this.chip!.textContent = want.chip ?? '';
      this.chip!.style.display = want.chip ? '' : 'none';
      this.size = want.size ?? 1;
      this.key = want.key;
      this.shown = 0;
      this.leaving = false;
      this.at.set(want.x, want.y, want.z);
    }
    if (this.key !== null && want?.key === this.key) {
      this.leaving = false;
      this.shown = Math.min(1, this.shown + step / APPEAR_SECONDS);
      const ease = 1 - Math.exp(-step * 12);
      this.at.x += (want.x - this.at.x) * ease;
      this.at.y += (want.y - this.at.y) * ease;
      this.at.z += (want.z - this.at.z) * ease;
    }

    const element = this.element;
    if (!element) return;
    if (this.key === null || this.shown <= 0.001) {
      element.style.display = 'none';
      return;
    }
    const pop = this.leaving ? MathUtils.smoothstep(this.shown, 0, 1) : Math.max(0.001, easeOutBack(this.shown, 2.1));
    anchor.set(this.at.x, this.at.y + Math.sin(seconds * 2.1 + this.phase) * 0.07, this.at.z);
    cameraUp.set(0, 1, 0).applyQuaternion(view.camera.quaternion);
    above.copy(anchor).add(cameraUp).project(view.camera);
    anchor.project(view.camera);
    if (anchor.z > 1 || anchor.z < -1) {
      element.style.display = 'none';
      return;
    }
    const perUnit = Math.hypot((above.x - anchor.x) * view.width / 2, (above.y - anchor.y) * view.height / 2);
    let scale = (perUnit * this.pill * this.size) / PILL_PX;
    element.style.display = '';
    let x = anchor.x;
    let y = anchor.y;
    if (keepIn) {
      scale = Math.min(scale, (view.width * 0.9) / Math.max(1, element.offsetWidth));
      x = MathUtils.clamp(x, -keepIn.x, keepIn.x);
      const tall = (element.offsetHeight * scale * 2) / view.height;
      y = Math.min(y, keepIn.top - tall);
    }
    const left = (x + 1) * view.width / 2;
    const top = (1 - y) * view.height / 2;
    element.style.setProperty('--accent', accent);
    element.style.opacity = String(Math.min(1, this.shown * 1.6));
    element.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px) translate(-50%, -100%) scale(${(scale * pop).toFixed(4)})`;
  }
}

const MAX_CHEVRONS = 96;
const SPACING = 0.95;
export const TRAIL_START_GAP = 1.1;
export const TRAIL_END_GAP = 0.35;
const TRAIL_Y = 0.06;
const GROW = 1.5;

function chevronGeometry() {
  const shape = new Shape();
  const w = 0.34;
  const d = 0.26;
  const t = 0.13;
  shape.moveTo(-w, -d);
  shape.lineTo(0, d - t);
  shape.lineTo(w, -d);
  shape.lineTo(w, -d + t * 1.35);
  shape.lineTo(0, d + t * 0.35);
  shape.lineTo(-w, -d + t * 1.35);
  shape.closePath();
  const geometry = new ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(Math.PI);
  return geometry;
}

const matrix = new Matrix4();
const place = new Vector3();
const turn = new Quaternion();
const scale = new Vector3();
const UP = new Vector3(0, 1, 0);
const cursor = { x: 0, z: 0, heading: 0 };

export type TrailLine = { points: FloorPoint[]; count: number; offset: number; startGap: number; endGap: number };
export type TrailRoute = { key: string; lines: TrailLine[] };

type Kept = { points: FloorPoint[]; count: number; offset: number; startGap: number; endGap: number };

export class FloorTrail {
  readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;
  private reach = 0;
  private key: string | null = null;
  private readonly lines: Kept[] = [];
  private lineCount = 0;

  constructor() {
    this.material = new MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    this.mesh = new InstancedMesh(chevronGeometry(), this.material, MAX_CHEVRONS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.layers.set(NO_REFLECTION_LAYER);
  }

  get showing() {
    return this.key !== null;
  }

  update(route: TrailRoute | null, accent: string, delta: number, beats: number, pulse: number) {
    const step = Math.min(delta, 0.1);
    if (route && (this.key === null || route.key === this.key)) {
      this.key = route.key;
      this.lineCount = route.lines.length;
      route.lines.forEach((line, index) => {
        const kept = this.lines[index] ?? (this.lines[index] = { points: [], count: 0, offset: 0, startGap: 0, endGap: 0 });
        kept.count = line.count;
        kept.offset = line.offset;
        kept.startGap = line.startGap;
        kept.endGap = line.endGap;
        for (let i = 0; i < line.count; i += 1) {
          const point = kept.points[i] ?? (kept.points[i] = { x: 0, z: 0 });
          point.x = line.points[i]!.x;
          point.z = line.points[i]!.z;
        }
      });
      this.reach = Math.min(1, this.reach + step * 1.1);
    } else if (this.key !== null) {
      this.reach = Math.max(0, this.reach - step * 3);
      if (this.reach <= 0) this.key = null;
    }

    if (this.key === null || this.lineCount === 0) {
      this.mesh.count = 0;
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.material.color.set(accent).multiplyScalar(0.85);

    let longest = 0;
    for (let l = 0; l < this.lineCount; l += 1) {
      const line = this.lines[l]!;
      longest = Math.max(longest, line.offset + routeLength(line.points, line.count));
    }
    const drawnTo = this.reach * (longest + GROW);
    const drift = (((beats % 1) + 1) % 1) * SPACING;
    let count = 0;
    for (let l = 0; l < this.lineCount && count < MAX_CHEVRONS; l += 1) {
      const line = this.lines[l]!;
      const usable = routeLength(line.points, line.count) - line.startGap - line.endGap;
      for (let d = drift; d < usable && count < MAX_CHEVRONS; d += SPACING) {
        const along = line.offset + line.startGap + d;
        const grow = MathUtils.clamp((drawnTo - along) / GROW, 0, 1);
        const ends = Math.min(MathUtils.smoothstep(d, 0, 0.9), MathUtils.smoothstep(usable - d, 0, 0.9));
        const size = grow * ends * (1 + pulse * 0.16);
        if (size <= 0.02) continue;
        alongRoute(line.points, line.count, line.startGap + d, cursor);
        place.set(cursor.x, TRAIL_Y, cursor.z);
        turn.setFromAxisAngle(UP, cursor.heading);
        scale.set(size, 1, size);
        matrix.compose(place, turn, scale);
        this.mesh.setMatrixAt(count, matrix);
        count += 1;
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
