import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  HalfFloatType,
  NearestFilter,
  RGBAFormat,
  Sphere,
  Vector3,
} from 'three';

export type CrowdClip = { name: string; row: number; frames: number; loop: boolean };
export type CrowdAsset = {
  fps: number;
  clips: CrowdClip[];
  bones: DataTexture;
  boneCount: number;
  lods: BufferGeometry[];
};

type Block = { offset: number; length: number };
type Header = {
  version: number;
  fps: number;
  bones: string[];
  clips: CrowdClip[];
  texture: { width: number; height: number; data: Block };
  lods: { vertices: number; triangles: number; position: Block; normal: Block; skin: Block; index: Block }[];
};

export const CROWD_FILE = '/characters/crowd.bin';

export const RIG_HEIGHT = 4.16;

export function parseCrowd(buffer: ArrayBuffer): CrowdAsset {
  const view = new DataView(buffer);
  const tag = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (tag !== 'KTBC') throw new Error('crowd.bin: not a crowd bake');
  const jsonLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, jsonLength))) as Header;
  if (header.version < 2) throw new Error('crowd.bin: baked before clips were marked as loops');
  const base = 8 + jsonLength;
  const at = <T>(Type: new (b: ArrayBuffer, o: number, l: number) => T, block: Block) => new Type(buffer, base + block.offset, block.length);

  const { width, height } = header.texture;
  const bones = new DataTexture(at(Uint16Array, header.texture.data), width, height, RGBAFormat, HalfFloatType);
  bones.minFilter = NearestFilter;
  bones.magFilter = NearestFilter;
  bones.generateMipmaps = false;
  bones.needsUpdate = true;

  const lods = header.lods.map((lod) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(at(Float32Array, lod.position), 3));
    geometry.setAttribute('aNormal', new BufferAttribute(at(Int8Array, lod.normal), 4, true));
    geometry.setAttribute('aSkin', new BufferAttribute(at(Uint8Array, lod.skin), 4));
    geometry.setIndex(new BufferAttribute(at(Uint16Array, lod.index), 1));
    geometry.boundingSphere = new Sphere(new Vector3(0, RIG_HEIGHT * 0.5, 0), RIG_HEIGHT * 0.95);
    return geometry;
  });

  return { fps: header.fps, clips: header.clips, bones, boneCount: header.bones.length, lods };
}
