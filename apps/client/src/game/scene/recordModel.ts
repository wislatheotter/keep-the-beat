import { useGLTF } from '@react-three/drei';
import { BufferAttribute, type BufferGeometry, type Group, type Mesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const RECORDS_FILE = '/props/records.glb';
const DRACO_DECODER = '/draco/';

export const RECORD_PART = { Vinyl: 0, Label: 1, Rim: 2, Metal: 3, Wing: 4, Spike: 5, Bolt: 6 } as const;

export const RECORD_RADIUS = 0.72;
export const RECORD_CUT = 0.56;
export const RECORD_LABEL_RADIUS = 0.3;

export type RecordGeometry = {
  body: BufferGeometry;
  wings: BufferGeometry;
  spikes: BufferGeometry;
};

const built = new WeakMap<Group, RecordGeometry>();

function weld(root: Group, name: string): BufferGeometry {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`records.glb has no ${name}`);
  object.updateWorldMatrix(true, true);
  const parts: BufferGeometry[] = [];
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const kind = (material?.name ?? '').split('.')[0] as keyof typeof RECORD_PART;
    const part = RECORD_PART[kind];
    if (part === undefined) throw new Error(`records.glb: ${name} has an unknown part "${material?.name}"`);
    const geometry = mesh.geometry.clone();
    for (const attribute of Object.keys(geometry.attributes)) {
      if (attribute !== 'position' && attribute !== 'normal') geometry.deleteAttribute(attribute);
    }
    geometry.applyMatrix4(mesh.matrixWorld);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('part', new BufferAttribute(new Float32Array(count).fill(part), 1));
    parts.push(geometry.index ? geometry : geometry.toNonIndexed());
  });
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error(`records.glb: could not merge ${name}`);
  for (const part of parts) part.dispose();
  merged.computeBoundingSphere();
  merged.boundingSphere!.radius = Math.max(merged.boundingSphere!.radius, 1.15);
  return merged;
}

export function useRecordGeometry(): RecordGeometry {
  const { scene } = useGLTF(RECORDS_FILE, DRACO_DECODER) as unknown as { scene: Group };
  let geometry = built.get(scene);
  if (!geometry) {
    geometry = {
      body: weld(scene, 'Record_Body'),
      wings: weld(scene, 'Record_Wings'),
      spikes: weld(scene, 'Record_Spikes'),
    };
    built.set(scene, geometry);
  }
  return geometry;
}

useGLTF.preload(RECORDS_FILE, DRACO_DECODER);
