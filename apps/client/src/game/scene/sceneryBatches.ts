import {
  BatchedMesh, Mesh,
  type BufferGeometry, type Material, type Object3D, type Scene,
} from 'three';

const SCENERY = 'keepTheBeatScenery';

export function markScenery<T extends Object3D>(root: T): T {
  root.userData[SCENERY] = true;
  return root;
}

type Instance = {
  source: Mesh;
  id: number;
  mask: number;
  visible: boolean;
  matrix: Float32Array;
  gone: boolean;
};

type Batch = { mesh: BatchedMesh; material: Material; instances: Instance[]; synced: number };

const CHEAP_BATCHES = new URLSearchParams(window.location.search).get('cull') !== '1';

let frameToken = 0;
export function nextSceneryFrame() {
  frameToken += 1;
}

function refusal(object: Object3D): string | null {
  const mesh = object as Mesh;
  if (!mesh.isMesh) return 'not a mesh';
  const kind = mesh as Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean; isBatchedMesh?: boolean };
  if (kind.isSkinnedMesh || kind.isInstancedMesh || kind.isBatchedMesh) return 'skinned or instanced';
  if (Array.isArray(mesh.material) || !mesh.material) return 'several materials';
  const material = mesh.material as Material & { isShaderMaterial?: boolean };
  if (material.isShaderMaterial) return 'custom shader';
  if (material.transparent || material.alphaHash) return 'see-through';
  if (mesh.onBeforeRender !== Mesh.prototype.onBeforeRender) return 'per-object hook';
  if (mesh.customDepthMaterial || mesh.customDistanceMaterial) return 'custom depth';
  const geometry = mesh.geometry;
  if (!geometry?.attributes.position) return 'no positions';
  if (Object.keys(geometry.morphAttributes).length > 0) return 'morph targets';
  if (geometry.groups.length > 1) return 'geometry groups';
  return null;
}

function layout(geometry: BufferGeometry) {
  const attributes = Object.keys(geometry.attributes).sort().map((name) => {
    const attribute = geometry.attributes[name]!;
    const array = (attribute as { array?: ArrayLike<number> }).array;
    return `${name}:${attribute.itemSize}:${array?.constructor.name}:${attribute.normalized ? 1 : 0}`;
  });
  return `${geometry.index ? 'indexed' : 'flat'}|${attributes.join(',')}`;
}

function detached(object: Object3D, scene: Scene) {
  let cursor: Object3D | null = object;
  while (cursor && cursor !== scene) cursor = cursor.parent;
  return cursor !== scene;
}

function shown(object: Object3D, scene: Scene) {
  for (let cursor: Object3D | null = object; cursor && cursor !== scene; cursor = cursor.parent) {
    if (!cursor.visible) return false;
  }
  return true;
}

function same(matrix: Float32Array, elements: number[]) {
  for (let i = 0; i < 16; i += 1) if (matrix[i] !== elements[i]) return false;
  return true;
}

export function batchScenery(scene: Scene) {
  scene.updateMatrixWorld(true);

  const wearers = new Map<Material, number>();
  scene.traverse((object) => {
    const material = (object as Mesh).material;
    if (!material) return;
    for (const each of Array.isArray(material) ? material : [material]) wearers.set(each, (wearers.get(each) ?? 0) + 1);
  });

  const candidates: Mesh[] = [];
  const refused: Record<string, number> = {};
  const elsewhere: string[] = [];
  const seen = new Set<Object3D>();
  scene.traverse((root) => {
    if (!root.userData[SCENERY]) return;
    root.traverse((object) => {
      if (seen.has(object)) return;
      seen.add(object);
      if (!(object as Mesh).isMesh) return;
      const why = refusal(object);
      if (why) refused[why] = (refused[why] ?? 0) + 1;
      else candidates.push(object as Mesh);
    });
  });

  const byMaterial = new Map<Material, Mesh[]>();
  for (const mesh of candidates) {
    const material = mesh.material as Material;
    if (!byMaterial.has(material)) byMaterial.set(material, []);
    byMaterial.get(material)!.push(mesh);
  }

  const groups = new Map<string, Mesh[]>();
  for (const [material, meshes] of byMaterial) {
    if (meshes.length !== wearers.get(material)) {
      refused['material worn elsewhere'] = (refused['material worn elsewhere'] ?? 0) + meshes.length;
      if (elsewhere.length < 40) {
        const inside = new Set<Object3D>(meshes);
        scene.traverse((object) => {
          if (inside.has(object) || (object as Mesh).material !== material || elsewhere.length >= 40) return;
          const path: string[] = [];
          for (let cursor: Object3D | null = object; cursor && cursor !== scene; cursor = cursor.parent) path.unshift(cursor.name || cursor.type);
          elsewhere.push(`${material.name || material.type} x${meshes.length}: ${path.join('/')} (${refusal(object) ?? (seen.has(object) ? 'scenery' : 'not scenery')})`);
        });
      }
      continue;
    }
    for (const mesh of meshes) {
      const key = [
        material.uuid, layout(mesh.geometry), mesh.castShadow, mesh.receiveShadow,
        mesh.layers.mask, mesh.renderOrder, mesh.frustumCulled,
      ].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(mesh);
    }
  }

  const batchedMaterials = new Set<Material>();
  for (const meshes of groups.values()) if (meshes.length > 1) batchedMaterials.add(meshes[0]!.material as Material);

  const batches: Batch[] = [];
  let taken = 0;
  for (const meshes of groups.values()) {
    if (meshes.length < 2 && !batchedMaterials.has(meshes[0]!.material as Material)) {
      refused['alone in its batch'] = (refused['alone in its batch'] ?? 0) + 1;
      continue;
    }
    const first = meshes[0]!;
    const geometries = [...new Set(meshes.map((mesh) => mesh.geometry))];
    const vertices = geometries.reduce((sum, geometry) => sum + geometry.attributes.position!.count, 0);
    const indices = geometries.reduce((sum, geometry) => sum + (geometry.index?.count ?? 0), 0);
    const material = first.material as Material;
    const mesh = new BatchedMesh(meshes.length, vertices, Math.max(indices, 1), material);
    mesh.name = 'scenery-batch';
    mesh.userData.sample = geometries[0];
    const ids = new Map<BufferGeometry, number>();
    for (const geometry of geometries) ids.set(geometry, mesh.addGeometry(geometry));
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.layers.mask = first.layers.mask;
    mesh.renderOrder = first.renderOrder;
    mesh.perObjectFrustumCulled = !CHEAP_BATCHES && first.frustumCulled;
    mesh.sortObjects = !CHEAP_BATCHES;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;

    const batch: Batch = { mesh, material, instances: [], synced: -1 };
    for (const source of meshes) {
      const id = mesh.addInstance(ids.get(source.geometry)!);
      mesh.setMatrixAt(id, source.matrixWorld);
      const visible = shown(source, scene);
      mesh.setVisibleAt(id, visible);
      batch.instances.push({
        source, id, mask: source.layers.mask, visible, matrix: new Float32Array(source.matrixWorld.elements), gone: false,
      });
      source.layers.mask = 0;
      taken += 1;
    }

    const sync = () => {
      if (batch.synced === frameToken) return;
      batch.synced = frameToken;
      for (const instance of batch.instances) {
        if (instance.gone) continue;
        const { source } = instance;
        if (source.material !== batch.material || detached(source, scene)) {
          instance.gone = true;
          mesh.setVisibleAt(instance.id, false);
          if (source.material !== batch.material) source.layers.mask = instance.mask;
          continue;
        }
        const visible = shown(source, scene);
        if (visible !== instance.visible) {
          instance.visible = visible;
          mesh.setVisibleAt(instance.id, visible);
        }
        if (visible && !same(instance.matrix, source.matrixWorld.elements)) {
          instance.matrix.set(source.matrixWorld.elements);
          mesh.setMatrixAt(instance.id, source.matrixWorld);
        }
      }
    };
    const render = mesh.onBeforeRender.bind(mesh);
    const shadow = mesh.onBeforeShadow.bind(mesh);
    mesh.onBeforeRender = (...args: Parameters<BatchedMesh['onBeforeRender']>) => { sync(); render(...args); };
    mesh.onBeforeShadow = (...args: Parameters<BatchedMesh['onBeforeShadow']>) => { sync(); shadow(...args); };

    scene.add(mesh);
    batches.push(batch);
  }

  return {
    batches: batches.length,
    meshes: taken,
    refused,
    elsewhere,
    dispose() {
      for (const batch of batches) {
        scene.remove(batch.mesh);
        for (const instance of batch.instances) if (!instance.gone) instance.source.layers.mask = instance.mask;
        batch.mesh.dispose();
      }
      batches.length = 0;
    },
  };
}

export function batchStandIn(batch: BatchedMesh, material: Material) {
  const geometry = batch.userData.sample as BufferGeometry;
  const double = new BatchedMesh(1, geometry.attributes.position!.count, Math.max(geometry.index?.count ?? 0, 1), material);
  double.addInstance(double.addGeometry(geometry));
  return double;
}
