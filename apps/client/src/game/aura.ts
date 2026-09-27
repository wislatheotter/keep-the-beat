import { AdditiveBlending, BackSide, Color, DoubleSide, MeshBasicMaterial, type Side } from 'three';
import { singlePass } from './scene/singlePass';

export function createAuraMaterial(color: string, side: Side = DoubleSide): MeshBasicMaterial {
  return singlePass(new MeshBasicMaterial({
    color: new Color(color).lerp(WHITE, 0.3).multiplyScalar(2.4),
    transparent: true,
    opacity: 0,
    visible: false,
    depthWrite: false,
    side,
    blending: AdditiveBlending,
    toneMapped: false,
  }));
}

const recordAuras = new Map<string, MeshBasicMaterial>();

export function recordAuraMaterial(color: string): MeshBasicMaterial {
  let material = recordAuras.get(color);
  if (!material) {
    material = createAuraMaterial(color, BackSide);
    material.opacity = 0.9;
    material.visible = true;
    recordAuras.set(color, material);
  }
  return material;
}

const FADED = 0.0005;

export function fadeAura(material: MeshBasicMaterial, target: number, delta: number) {
  let opacity = material.opacity + (target - material.opacity) * Math.min(1, delta * 14);
  if (target === 0 && opacity < FADED) opacity = 0;
  material.opacity = opacity;
  material.visible = opacity > 0;
}

export function auraPulse(now: number) {
  return 0.7 + 0.3 * Math.sin(now / 140);
}

export function pulseRecordAuras(now: number) {
  const pulse = auraPulse(now);
  for (const material of recordAuras.values()) material.opacity = 0.55 + pulse * 0.45;
}

const WHITE = new Color('#ffffff');
