import { Color, MeshStandardMaterial } from 'three';
import type { ThemeLook } from '@loop/shared';

export type TrimKind = 'Dark' | 'Metal' | 'Brass' | 'Cream' | 'Wood' | 'Hazard';
export type Trim = Record<TrimKind, MeshStandardMaterial>;

const standard = (hex: string, roughness: number, metalness = 0) => new MeshStandardMaterial({
  color: hex, roughness, metalness, envMapIntensity: 0.9,
});

let shared: Trim | null = null;
const night = new Color();
const accent = new Color();

export function stageTrim(look: ThemeLook): Trim {
  if (!shared) {
    shared = {
      Dark: standard('#1d2236', 0.62, 0.2),
      Metal: standard('#d3dae8', 0.28, 0.85),
      Brass: standard('#f0bf4a', 0.32, 0.85),
      Cream: standard('#fbf2e4', 0.55),
      Wood: standard('#c07a45', 0.6),
      Hazard: standard('#ffcc33', 0.5),
    };
    paintTrim(look);
  }
  return shared;
}

export function paintTrim(look: ThemeLook) {
  if (!shared) return;
  shared.Dark.color.set('#1d2236').lerp(night.set(look.night), 0.25);
  shared.Metal.color.set('#d3dae8').lerp(accent.set(look.accent), 0.08);
}

export function isTrim(material: MeshStandardMaterial) {
  return !!shared && Object.values(shared).includes(material);
}
