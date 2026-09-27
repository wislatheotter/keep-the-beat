import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending, BackSide, type BatchedMesh, BufferAttribute, BufferGeometry, DoubleSide, FrontSide, HalfFloatType, InstancedMesh, Mesh, MeshBasicMaterial,
  Material, MeshDepthMaterial, MeshDistanceMaterial, Scene, SkinnedMesh, SphereGeometry, WebGLRenderTarget,
  type Camera, type Light, type Object3D, type Side, type Texture, type WebGLRenderer,
} from 'three';
import { LOOP_LAYERS, everyFx } from '@loop/shared';
import { Vinyl } from './Vinyl';
import { BeaconBeam } from './BeaconBeam';
import { DEV_HANDLE } from '../../runtime/devFlag';
import { useBackstage } from '../backstage';
import type { PostWarmTarget } from './PostFX';
import { reportLights } from '../../entry';
import { ConvolutionMaterial } from '@react-three/drei/materials/ConvolutionMaterial';
import { PERFORMANCE } from '../performance';
import { batchStandIn } from './sceneryBatches';
import { DRACO_DECODER, RIG_FILES } from './PerformerRig';

const SETTLE_BATCH = 6;

function settleUniforms(gl: WebGLRenderer) {
  for (const program of gl.info.programs ?? []) touch(program);
}

async function settleUniformsGently(gl: WebGLRenderer, cancelled: () => boolean) {
  const programs = [...(gl.info.programs ?? [])];
  for (let i = 0; i < programs.length; i += SETTLE_BATCH) {
    if (cancelled()) return;
    if (wanted()) {
      for (const program of programs.slice(i)) touch(program);
      return;
    }
    for (const program of programs.slice(i, i + SETTLE_BATCH)) touch(program);
    reportLights(COMPILED_SHARE + (1 - COMPILED_SHARE) * Math.min(1, (i + SETTLE_BATCH) / programs.length));
    await breathe();
  }
}

const wanted = () => !useBackstage.getState().backstage;

const COMPILED_SHARE = 0.8;

const SUBMITTED_SHARE = 0.4;

function linked(gl: WebGLRenderer, materials: Set<Material>): Promise<void> {
  const total = Math.max(1, materials.size);
  return new Promise((resolve) => {
    const check = () => {
      for (const material of materials) {
        const program = (gl.properties.get(material) as { currentProgram?: { isReady: () => boolean } }).currentProgram;
        if (!program || program.isReady()) materials.delete(material);
      }
      reportLights(COMPILED_SHARE * (SUBMITTED_SHARE + (1 - SUBMITTED_SHARE) * (1 - materials.size / total)));
      if (materials.size === 0) resolve();
      else setTimeout(check, 10);
    };
    check();
  });
}

type Job = { run: () => Iterable<Material>; canvas?: boolean };

const GENTLE = { sliceMs: 8, perSlice: 3, inFlight: 8 };
const HURRIED = { sliceMs: 30, perSlice: 4, inFlight: 64 };

type Program = { isReady: () => boolean };

function roomFor(programs: Program[], room: number, stop: () => boolean, limit = 1500): Promise<void> {
  const until = performance.now() + limit;
  const busy = () => {
    for (let i = programs.length - 1; i >= 0; i -= 1) if (programs[i]!.isReady()) programs.splice(i, 1);
    return programs.length >= room;
  };
  if (!busy()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (stop() || performance.now() > until || !busy()) resolve();
      else setTimeout(check, 8);
    };
    setTimeout(check, 8);
  });
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Lit = <T>(run: () => T, fog?: Scene['fog']) => T;

function quickLights(scene: Scene): Lit {
  const lights: Object3D[] = [];
  scene.traverseVisible((object) => { if ((object as Light).isLight) lights.push(object); });
  const walk = (callback: (object: Object3D) => void) => { for (const light of lights) callback(light); };
  return (run, fog = scene.fog) => {
    const own = Object.getOwnPropertyDescriptor(scene, 'traverseVisible');
    const before = scene.fog;
    scene.traverseVisible = walk;
    scene.fog = fog;
    try {
      return run();
    } finally {
      if (own) Object.defineProperty(scene, 'traverseVisible', own);
      else delete (scene as { traverseVisible?: unknown }).traverseVisible;
      scene.fog = before;
    }
  };
}

function reshapes(object: Object3D) {
  const material = (object as Mesh).material;
  return (Array.isArray(material) ? material : [material]).some((each) => each && each.onBeforeCompile !== Material.prototype.onBeforeCompile);
}

function prepareJobs(gl: WebGLRenderer, objects: Object3D[]): Job[] {
  const jobs: Job[] = [];
  const textures = new Set<Texture>();
  for (const object of objects) {
    object.traverse((node) => {
      const mesh = node as Mesh & { isSkinnedMesh?: boolean; boundingSphere?: unknown; computeBoundingSphere?: () => void };
      if (!mesh.geometry) return;
      if (mesh.frustumCulled) {
        if ((mesh.isSkinnedMesh || (mesh as unknown as InstancedMesh).isInstancedMesh) && mesh.boundingSphere === null) {
          jobs.push({ run: () => { mesh.computeBoundingSphere?.(); return []; } });
        } else if (mesh.geometry.boundingSphere === null) {
          jobs.push({ run: () => { mesh.geometry.computeBoundingSphere(); return []; } });
        }
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!material) continue;
        for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) textures.add(value as Texture);
        const uniforms = (material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
        for (const uniform of Object.values(uniforms ?? {})) {
          if ((uniform?.value as Texture | null)?.isTexture) textures.add(uniform.value as Texture);
        }
      }
    });
  }
  for (const texture of textures) {
    if ((texture as Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture || !texture.image) continue;
    jobs.push({ run: () => { gl.initTexture(texture); return []; } });
  }
  return jobs;
}

const STAGING_LAYER = 31;
const STAGING_CHUNK = 16;

function stagingJobs(gl: WebGLRenderer, scene: Scene, camera: Camera): Job[] {
  const objects = drawables(scene).filter((object) => object.layers.mask !== 0);
  const lights: Object3D[] = [];
  scene.traverse((object) => { if ((object as Light).isLight) lights.push(object); });
  const staging = camera.clone();
  staging.layers.set(STAGING_LAYER);
  const jobs: Job[] = [];
  for (let i = 0; i < objects.length; i += STAGING_CHUNK) {
    const chunk = objects.slice(i, i + STAGING_CHUNK);
    const first = i === 0;
    jobs.push({
      run: () => {
        const marked: Object3D[] = [...lights];
        const unculled: Object3D[] = [];
        for (const root of chunk) {
          root.traverse((node) => {
            marked.push(node);
            if (node.frustumCulled) { node.frustumCulled = false; unculled.push(node); }
          });
        }
        for (const node of marked) node.layers.enable(STAGING_LAYER);
        const autoUpdate = scene.matrixWorldAutoUpdate;
        scene.matrixWorldAutoUpdate = first;
        try {
          gl.render(scene, staging);
        } finally {
          scene.matrixWorldAutoUpdate = autoUpdate;
          for (const node of marked) node.layers.disable(STAGING_LAYER);
          for (const node of unculled) node.frustumCulled = true;
        }
        return [];
      },
    });
  }
  return jobs;
}

function drawables(root: Object3D, out: Object3D[] = []): Object3D[] {
  for (const child of root.children) {
    const object = child as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean; material?: unknown };
    if ((object.isMesh || object.isPoints || object.isLine || object.isSprite) && object.material) out.push(object);
    else drawables(object, out);
  }
  return out;
}

function touch(program: unknown) {
  try { (program as { getUniforms: () => unknown }).getUniforms(); } catch {}
}

function breathe(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => { setTimeout(resolve, 0); });
  });
}

function postJobs(gl: WebGLRenderer, targets: PostWarmTarget[], canvas: boolean): Job[] {
  return targets.filter((target) => target.screen).flatMap((target) => target.materials.map((material): Job => ({
    canvas,
    run: () => {
      const screen = target.screen;
      const previous = screen.material;
      screen.material = material;
      try {
        return gl.compile(target.scene, target.camera);
      } finally {
        screen.material = previous;
      }
    },
  })));
}

const SHADOW_SIDE: Record<number, Side> = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };

function shadowVariant(base: MeshDepthMaterial | MeshDistanceMaterial, material: Material): Material {
  const variant = base.clone();
  const source = material as Material & Partial<MeshDepthMaterial>;
  variant.visible = material.visible;
  (variant as { wireframe?: boolean }).wireframe = (source as { wireframe?: boolean }).wireframe ?? false;
  variant.side = material.shadowSide !== null ? material.shadowSide : SHADOW_SIDE[material.side]!;
  variant.alphaMap = source.alphaMap ?? null;
  variant.alphaTest = material.alphaToCoverage ? 0.5 : material.alphaTest;
  variant.map = source.map ?? null;
  variant.clipShadows = material.clipShadows;
  variant.clippingPlanes = material.clippingPlanes;
  variant.clipIntersection = material.clipIntersection;
  variant.displacementMap = source.displacementMap ?? null;
  variant.displacementScale = source.displacementScale ?? 1;
  variant.displacementBias = source.displacementBias ?? 0;
  return variant;
}

function standIn(mesh: Mesh, material: Material | Material[]): Object3D {
  if ((mesh as unknown as BatchedMesh).isBatchedMesh && !Array.isArray(material)) {
    return batchStandIn(mesh as unknown as BatchedMesh, material);
  }
  if ((mesh as SkinnedMesh).isSkinnedMesh) {
    const skinned = mesh as SkinnedMesh;
    const double = new SkinnedMesh(skinned.geometry, material);
    double.bind(skinned.skeleton, skinned.bindMatrix);
    return double;
  }
  if ((mesh as InstancedMesh).isInstancedMesh) {
    const instanced = mesh as InstancedMesh;
    const double = new InstancedMesh(instanced.geometry, material, 1);
    double.instanceColor = instanced.instanceColor;
    return double;
  }
  return new Mesh(mesh.geometry, material);
}

function shadowJobs(gl: WebGLRenderer, scene: Scene, camera: Camera, made: Array<{ dispose: () => void }>, lit: Lit): Job[] {
  if (!gl.shadowMap.enabled) return [];
  let spot = false;
  let point = false;
  scene.traverseVisible((object) => {
    const light = object as Object3D & { isLight?: boolean; isPointLight?: boolean; castShadow: boolean };
    if (!light.isLight || !light.castShadow) return;
    if (light.isPointLight) point = true;
    else spot = true;
  });
  const passes: Array<[MeshDepthMaterial | MeshDistanceMaterial, 'customDepthMaterial' | 'customDistanceMaterial']> = [];
  if (spot) passes.push([new MeshDepthMaterial(), 'customDepthMaterial']);
  if (point) passes.push([new MeshDistanceMaterial(), 'customDistanceMaterial']);
  const jobs: Job[] = [];
  for (const [base, custom] of passes) {
    made.push(base);
    scene.traverseVisible((object) => {
      const mesh = object as Mesh;
      if (!mesh.castShadow || !mesh.material || !(mesh.isMesh)) return;
      jobs.push({
        run: () => {
          const wear = (material: Material) => {
            const customMaterial = (mesh as unknown as Record<string, Material | undefined>)[custom];
            if (customMaterial) return customMaterial;
            const variant = shadowVariant(base, material);
            made.push(variant);
            return variant;
          };
          const double = standIn(mesh, Array.isArray(mesh.material) ? mesh.material.map(wear) : wear(mesh.material));
          return lit(() => gl.compile(double, camera, scene), null);
        },
      });
    });
  }
  return jobs;
}

function mirrorJobs(gl: WebGLRenderer, camera: Camera, keep: Array<{ dispose: () => void }>): Job[] {
  if (!PERFORMANCE.reflections) return [];
  const material = new ConvolutionMaterial();
  material.defines.USE_DEPTH = true;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  keep.push(material, geometry);
  return [{ run: () => gl.compile(scene, camera) }];
}

export function ShaderWarmup({ postTargets, onReady }: { postTargets: PostWarmTarget[]; onReady: () => void }) {
  const gl = useThree((three) => three.gl);
  const scene = useThree((three) => three.scene);
  const camera = useThree((three) => three.camera);
  const rigs = (useGLTF(RIG_FILES, DRACO_DECODER) as unknown as Array<{ scene: Object3D }>).map((rig) => rig.scene);

  useEffect(() => {
    let cancelled = false;
    const shadowMaterials: Array<{ dispose: () => void }> = [];
    const target = new WebGLRenderTarget(4, 4, { type: HalfFloatType });
    const previous = gl.getRenderTarget();

    const finish = () => {
      target.dispose();
      if (DEV_HANDLE) {
        const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
        handle.warmKeys = (gl.info.programs ?? []).map((program) => program.cacheKey);
        (window as unknown as { __loop?: unknown }).__loop = handle;
      }
      if (!cancelled) onReady();
    };

    const pace = () => (wanted() ? HURRIED : GENTLE);
    const materials = new Set<Material>();
    const run = (job: Job) => {
      gl.setRenderTarget(job.canvas ? previous : target);
      try {
        for (const material of job.run()) materials.add(material);
      } catch {
      } finally {
        gl.setRenderTarget(previous);
      }
    };

    const lit = quickLights(scene);
    const objects = drawables(scene);
    const compileJob = (object: Object3D): Job => ({ run: () => lit(() => gl.compile(object, camera, scene)) });
    const jobs: Job[] = [
      ...objects.map(compileJob),
      ...objects.filter(reshapes).map(compileJob),
      ...shadowJobs(gl, scene, camera, shadowMaterials, lit),
      ...mirrorJobs(gl, camera, shadowMaterials),
      ...postJobs(gl, postTargets, false),
      ...postJobs(gl, postTargets, true),
      ...prepareJobs(gl, [scene, ...rigs]),
    ];

    const submit = async (jobs: Job[]) => {
      const programs = () => (gl.info.programs ?? []) as unknown as Program[];
      const linking: Program[] = [];
      let known = programs().length;
      let slice = performance.now();
      let sliceStart = known;
      const stop = () => cancelled;
      for (let i = 0; i < jobs.length; i += 1) {
        if (cancelled) return;
        const { sliceMs, perSlice, inFlight } = pace();
        const all = programs();
        for (; known < all.length; known += 1) linking.push(all[known]!);
        if (linking.length >= inFlight) {
          reportLights(COMPILED_SHARE * SUBMITTED_SHARE * (i / jobs.length));
          await roomFor(linking, inFlight, stop);
          slice = performance.now();
          sliceStart = known;
        } else if (known - sliceStart >= perSlice || performance.now() - slice > sliceMs) {
          reportLights(COMPILED_SHARE * SUBMITTED_SHARE * (i / jobs.length));
          await turn();
          slice = performance.now();
          sliceStart = known;
        }
        run(jobs[i]!);
      }
    };

    const times: Record<string, number> = { start: performance.now(), jobs: jobs.length };
    if (DEV_HANDLE) ((window as unknown as { __loop?: Record<string, unknown> }).__loop ??= {}).warmTimes = times;
    reportLights(0);
    void submit(jobs)
      .then(() => { times.submitted = performance.now(); })
      .then(() => linked(gl, materials))
      .then(() => { times.linked = performance.now(); })
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) { target.dispose(); return; }
        if (!wanted()) await settleUniformsGently(gl, () => cancelled);
        else settleUniforms(gl);
        times.settled = performance.now();
        if (!cancelled) await submit(stagingJobs(gl, scene, camera));
        times.staged = performance.now();
        if (cancelled) { target.dispose(); return; }
        reportLights(1);
        finish();
      });
    return () => {
      cancelled = true;
      for (const material of shadowMaterials) material.dispose();
    };
  }, []);

  const fade = useMemo(() => ({ current: 0.5 }), []);
  const ring = useMemo(() => new MeshBasicMaterial({
    transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide, forceSinglePass: true, blending: AdditiveBlending, toneMapped: false,
  }), []);
  const instanced = useMemo(() => new InstancedMesh(
    new SphereGeometry(0.06, 6, 4),
    new MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false }),
    1,
  ), []);

  return (
    <group visible={false}>
      {LOOP_LAYERS.map((layer) => (
        <group key={layer}>
          <Vinyl role={layer} fx={everyFx()} glow={0.5} highlight />
          <Vinyl role={layer} glow={0.2} />
          <Vinyl role={layer} glow={1} fade={fade} />
        </group>
      ))}
      <BeaconBeam color="#ffffff" />
      <mesh material={ring}>
        <ringGeometry args={[0.6, 0.8, 8]} />
      </mesh>
      <primitive object={instanced} />
    </group>
  );
}
