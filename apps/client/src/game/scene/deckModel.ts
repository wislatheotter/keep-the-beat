import { useGLTF } from '@react-three/drei';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Color, type Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { LAYER_COLORS, LOOP_LAYERS, type LoopLayer, type ThemeLook } from '@loop/shared';
import { PERFORMANCE } from '../performance';
import { markScenery } from './sceneryBatches';

export const DECK_FILE = '/stations/deck.glb';
const DRACO_DECODER = '/draco/';

export const DECK_TOP = 1.2;
export const RING_INNER = 5.35;
export const SLOT_TOP = 1.38;
export const RECORD_Y = 1.49;
export const HUB_RADIUS = 1.75;
export const HUB_SHOULDER_Y = DECK_TOP + 0.3;
export const HUB_TOP_Y = DECK_TOP + 0.84;
export const METER_AT = { x: -1.05, z: -1.05 } as const;
export const PLATTER_SIZE = 1.08;

type SharedKind = 'Shell' | 'Plate' | 'Track' | 'Dark' | 'Chrome' | 'Metal' | 'Cream' | 'Trim' | 'Glow' | 'Rim' | 'Spoke';
export type DeckMaterials = Record<SharedKind, MeshStandardMaterial>;

export type SlotModel = {
  root: Object3D;
  platter: Object3D;
  arm: Object3D;
  armRest: { y: number; x: number };
  collar: MeshStandardMaterial;
  trim: MeshStandardMaterial;
};

export type DeckModel = {
  base: Object3D;
  hub: Object3D;
  cone: Object3D;
  coneRestY: number;
  crown: Object3D;
  orbit: Object3D;
  slots: Record<LoopLayer, SlotModel>;
  materials: DeckMaterials;
};

function createMaterials(look: ThemeLook): DeckMaterials {
  const standard = (roughness: number, metalness = 0, envMapIntensity = 0.8) =>
    new MeshStandardMaterial({ roughness, metalness, envMapIntensity });
  const glowing = () => {
    const material = standard(0.4);
    material.toneMapped = false;
    return material;
  };
  const materials: DeckMaterials = {
    Shell: standard(0.3, 0.42),
    Plate: standard(0.42, 0.3, 0.6),
    Track: standard(0.95, 0, 0.2),
    Dark: standard(0.62, 0.2),
    Chrome: standard(0.18, 1, 1),
    Metal: standard(0.3, 0.85),
    Cream: standard(0.55),
    Trim: standard(0.4, 0.3),
    Glow: glowing(),
    Rim: glowing(),
    Spoke: glowing(),
  };
  paintMaterials(materials, look);
  return materials;
}

export function paintMaterials(materials: DeckMaterials, look: ThemeLook) {
  const night = new Color(look.night);
  const accent = new Color(look.accent);
  const secondary = new Color(look.secondary);
  const glow = (material: MeshStandardMaterial, color: Color, intensity: number) => {
    material.color.copy(color);
    material.emissive.copy(color);
    material.emissiveIntensity = intensity;
  };
  materials.Shell.color.set('#443766').lerp(accent, 0.22);
  materials.Plate.color.set('#29243e').lerp(night, 0.12);
  materials.Track.color.set('#05070b');
  materials.Dark.color.set('#12151f').lerp(night, 0.2);
  materials.Chrome.color.set('#e6ebf5').lerp(accent, 0.06);
  materials.Metal.color.set('#aab3c6').lerp(accent, 0.08);
  materials.Cream.color.set('#fbf2e4');
  materials.Trim.color.copy(accent).lerp(new Color('#ffffff'), 0.04);
  materials.Trim.emissive.copy(accent);
  materials.Trim.emissiveIntensity = 0.25;
  glow(materials.Glow, accent, 1.2);
  glow(materials.Rim, accent, 1.0);
  glow(materials.Spoke, secondary, 0.8);
}

function kindOf(object: Mesh) {
  const name = (object.material as { name?: string }).name ?? '';
  return name.split('.')[0]!;
}

export function useDeckModel(look: ThemeLook): DeckModel {
  const { scene } = useGLTF(DECK_FILE, DRACO_DECODER) as unknown as { scene: Group };
  const model = useMemo(() => {
    const materials = createMaterials(look);
    const piece = (name: string, paint: (mesh: Mesh, kind: string) => MeshStandardMaterial | undefined = () => undefined) => {
      const source = scene.getObjectByName(name);
      if (!source) throw new Error(`deck.glb has no ${name}`);
      const root = markScenery(source.clone(true));
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
      root.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const kind = kindOf(object);
        object.material = paint(object, kind) ?? materials[kind as SharedKind] ?? materials.Dark;
        const owner = object.name.endsWith('_Static') || object.parent?.name.endsWith('_Static');
        object.castShadow = PERFORMANCE.shadows && !!owner;
        object.receiveShadow = true;
      });
      return root;
    };
    const part = (root: Object3D, name: string) => {
      const found = root.getObjectByName(name);
      if (!found) throw new Error(`deck.glb has no ${name}`);
      return found;
    };

    const base = piece('Deck_Base');
    const hub = piece('Deck_Hub');
    const cone = part(hub, 'Hub_Cone');
    const crown = part(hub, 'Hub_Crown');
    const orbit = part(hub, 'Hub_Orbit');
    const slots = {} as Record<LoopLayer, SlotModel>;
    for (const layer of LOOP_LAYERS) {
      const color = new Color(LAYER_COLORS[layer]);
      const collar = new MeshStandardMaterial({ color, emissive: color.clone(), emissiveIntensity: 0.25, roughness: 0.4, toneMapped: false });
      const trim = new MeshStandardMaterial({ color, emissive: color.clone(), emissiveIntensity: 0.15, roughness: 0.45, metalness: 0.2 });
      const root = piece('Deck_Slot', (_, kind) => (kind === 'Collar' ? collar : kind === 'LayerTrim' ? trim : undefined));
      const arm = part(root, 'Slot_Arm');
      slots[layer] = {
        root,
        platter: part(root, 'Slot_Platter'),
        arm,
        armRest: { y: arm.rotation.y, x: arm.rotation.x },
        collar,
        trim,
      };
    }
    return { base, hub, cone, coneRestY: cone.position.y, crown, orbit, slots, materials };
  }, [scene]);
  useLayoutEffect(() => paintMaterials(model.materials, look), [model, look]);
  useEffect(() => () => {
    for (const material of Object.values(model.materials)) material.dispose();
    for (const slot of Object.values(model.slots)) {
      slot.collar.dispose();
      slot.trim.dispose();
    }
  }, [model]);
  return model;
}

useGLTF.preload(DECK_FILE, DRACO_DECODER);
