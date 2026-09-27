import {
  Color,
  DataTexture,
  Material,
  Mesh,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';

const gradientData = new Uint8Array([160, 196, 220, 238, 255]);
export const toonGradient = new DataTexture(gradientData, 5, 1, RedFormat, UnsignedByteType);
toonGradient.minFilter = NearestFilter;
toonGradient.magFilter = NearestFilter;
toonGradient.generateMipmaps = false;
toonGradient.needsUpdate = true;

const FUR_GAIN = 1.5;

function brightenFur(shader: WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    {
      float furHi = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
      float furLo = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
      float furChroma = (furHi - furLo) / max(furHi, 1e-4);
      float fur = smoothstep(0.5, 0.8, dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)))
        * (1.0 - smoothstep(0.08, 0.2, furChroma));
      float furGain = mix(1.0, ${FUR_GAIN.toFixed(2)}, fur);
      reflectedLight.directDiffuse *= furGain;
      reflectedLight.indirectDiffuse *= furGain;
    }`);
}

const materialCache = new WeakMap<Material, Material>();
const hsl = { h: 0, s: 0, l: 0 };

function convertMaterial(source: Material): Material {
  const cached = materialCache.get(source);
  if (cached) return cached;

  const standard = source as MeshStandardMaterial;
  const color = standard.color?.clone?.() ?? new Color('#ffffff');

  color.getHSL(hsl);
  color.setHSL(hsl.h, Math.min(1, hsl.s * 1.18), Math.min(1, 0.1 + hsl.l * 0.94));

  const toon = new MeshToonMaterial({
    color,
    map: standard.map ?? null,
    gradientMap: toonGradient,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
    depthWrite: source.depthWrite,
    depthTest: source.depthTest,
    vertexColors: standard.vertexColors ?? false,
  });

  if ('emissive' in standard && standard.emissive) toon.emissive.copy(standard.emissive);
  if ('emissiveIntensity' in standard && typeof standard.emissiveIntensity === 'number') {
    toon.emissiveIntensity = Math.min(0.3, standard.emissiveIntensity);
  }
  toon.onBeforeCompile = brightenFur;
  toon.customProgramCacheKey = () => 'performer-fur';
  toon.name = `${source.name || 'material'}__toon`;
  materialCache.set(source, toon);
  return toon;
}

export function furToonMaterial(color: string) {
  const toon = new MeshToonMaterial({ color, gradientMap: toonGradient });
  toon.onBeforeCompile = brightenFur;
  toon.customProgramCacheKey = () => 'performer-fur';
  return toon;
}

export function applyToonStyle(root: Object3D, castShadow = true) {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = castShadow;
    mesh.frustumCulled = true;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convertMaterial)
      : convertMaterial(mesh.material);
  });
  return root;
}
