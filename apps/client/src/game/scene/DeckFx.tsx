import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Points,
  RingGeometry,
  ShaderMaterial,
} from 'three';

const dummy = new Object3D();

export function lampRing(count: number, radius: number, y: number, size: [number, number, number], base = 0) {
  const geometry = new BoxGeometry(...size);
  if (base) geometry.translate(0, size[1] / 2, 0);
  const material = new MeshBasicMaterial({ toneMapped: false });
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.instanceColor.setUsage(DynamicDrawUsage);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    dummy.position.set(Math.sin(a) * radius, y, Math.cos(a) * radius);
    dummy.rotation.set(0, a, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.frustumCulled = false;
  return mesh;
}

export function setLamp(mesh: InstancedMesh, i: number, count: number, radius: number, y: number, height: number, color: Color, gain: number) {
  if (height >= 0) {
    const a = (i / count) * Math.PI * 2;
    dummy.position.set(Math.sin(a) * radius, y, Math.cos(a) * radius);
    dummy.rotation.set(0, a, 0);
    dummy.scale.set(1, Math.max(0.001, height), 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceColor!.setXYZ(i, color.r * gain, color.g * gain, color.b * gain);
}

export const METER_CELLS = 8;

export function meterColumn(x: number, z: number, bottom: number, step: number) {
  const mesh = new InstancedMesh(new BoxGeometry(0.2, step * 0.74, 0.2), new MeshBasicMaterial({ toneMapped: false }), METER_CELLS);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(METER_CELLS * 3), 3);
  mesh.instanceColor.setUsage(DynamicDrawUsage);
  for (let i = 0; i < METER_CELLS; i += 1) {
    mesh.setMatrixAt(i, new Matrix4().makeTranslation(x, bottom + step * (i + 0.5), z));
  }
  return mesh;
}

export function shaftMaterial(color: string) {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uIntensity: { value: 0 } },
    vertexShader: `
      varying float vHeight;
      varying float vEdge;
      void main() {
        vHeight = uv.y;
        vec3 n = normalize(normalMatrix * normal);
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vEdge = 1.0 - abs(dot(n, normalize(-view.xyz)));
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vHeight;
      varying float vEdge;
      void main() {
        float fade = pow(clamp(1.0 - vHeight, 0.0, 1.0), 2.2);
        float edge = 0.35 + 0.65 * vEdge;
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

export const SHAFT_HEIGHT = 7;
export const shaftGeometry = (() => {
  const geometry = new CylinderGeometry(1.7, 0.85, SHAFT_HEIGHT, 28, 1, true);
  geometry.translate(0, SHAFT_HEIGHT / 2, 0);
  return geometry;
})();

export const waveGeometry = new RingGeometry(0.92, 1.0, 64);
export function waveMaterial(color: string) {
  return new MeshBasicMaterial({
    color, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide, forceSinglePass: true,
  });
}

const sprite = (() => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
})();

export type Emit = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  color: Color;
  life: number;
  size: number;
  swirl?: number;
  gravity?: number;
};

export class DeckParticles {
  readonly points: Points;
  private readonly capacity: number;
  private readonly position: Float32Array;
  private readonly color: Float32Array;
  private readonly size: Float32Array;
  private readonly velocity: Float32Array;
  private readonly tint: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly swirl: Float32Array;
  private readonly gravity: Float32Array;
  private next = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.position = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.tint = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(1);
    this.life = new Float32Array(capacity).fill(1);
    this.baseSize = new Float32Array(capacity);
    this.swirl = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.position, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('color', new BufferAttribute(this.color, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('size', new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    const material = new ShaderMaterial({
      uniforms: { uMap: { value: sprite }, uScale: { value: 300 } },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -view.z);
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
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(p: Emit) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.position.set([p.x, p.y, p.z], i * 3);
    this.velocity.set([p.vx, p.vy, p.vz], i * 3);
    this.tint.set([p.color.r, p.color.g, p.color.b], i * 3);
    this.age[i] = 0;
    this.life[i] = p.life;
    this.baseSize[i] = p.size;
    this.swirl[i] = p.swirl ?? 0;
    this.gravity[i] = p.gravity ?? 0;
  }

  update(dt: number, time: number) {
    for (let i = 0; i < this.capacity; i += 1) {
      const life = this.life[i]!;
      let age = this.age[i]!;
      if (age >= life) {
        this.size[i] = 0;
        continue;
      }
      age += dt;
      this.age[i] = age;
      const t = Math.min(1, age / life);
      const k = i * 3;
      const swirl = this.swirl[i]!;
      this.velocity[k + 1] = this.velocity[k + 1]! - this.gravity[i]! * dt;
      this.position[k] = this.position[k]! + (this.velocity[k]! + Math.sin(time * 2.1 + i) * swirl) * dt;
      this.position[k + 1] = this.position[k + 1]! + this.velocity[k + 1]! * dt;
      this.position[k + 2] = this.position[k + 2]! + (this.velocity[k + 2]! + Math.cos(time * 1.7 + i * 1.3) * swirl) * dt;
      const alpha = Math.min(1, t * 8) * (1 - t) ** 1.4;
      this.color[k] = this.tint[k]! * alpha * 1.8;
      this.color[k + 1] = this.tint[k + 1]! * alpha * 1.8;
      this.color[k + 2] = this.tint[k + 2]! * alpha * 1.8;
      this.size[i] = this.baseSize[i]! * (0.6 + t * 0.6);
    }
    const geometry = this.points.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
    geometry.getAttribute('size').needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}
