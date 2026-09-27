import type { Camera, Object3D } from 'three';

export const NO_REFLECTION_LAYER = 1;

export function hideFromReflection(root: Object3D) {
  root.traverse((object) => object.layers.set(NO_REFLECTION_LAYER));
}

export function seeEveryLayer(camera: Camera) {
  camera.layers.enable(NO_REFLECTION_LAYER);
}
