import type { Material } from 'three';

export const FORCE_SINGLE_PASS = true;

export function singlePass<T extends Material>(material: T): T {
  material.forceSinglePass = true;
  return material;
}
