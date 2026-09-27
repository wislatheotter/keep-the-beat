import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { LAYER_COLORS, sample as gameSample, type FxSet, type SampleRole } from '@loop/shared';
import { PERFORMANCE } from '../performance';
import { recordAuraMaterial } from '../aura';
import { labelKey, recordLabel } from '../recordArt';
import { RECORD_RADIUS, useRecordGeometry } from './recordModel';
import { createRecordMaterials, echoGeometry, echoMaterial, freshMarks, fxMask, spaceGeometry, spaceMaterial } from './recordMaterial';

const labelTextures = new Map<string, CanvasTexture>();

const LABEL_CACHE_LIMIT = 160;

function labelFor(role: SampleRole, family: string, sampleName: string | null) {
  const key = labelKey(role, family, sampleName);
  const existing = labelTextures.get(key);
  if (existing) {
    labelTextures.delete(key);
    labelTextures.set(key, existing);
    return existing;
  }

  const texture = new CanvasTexture(recordLabel(role, family, sampleName));
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  labelTextures.set(key, texture);
  while (labelTextures.size > LABEL_CACHE_LIMIT) {
    const oldest = labelTextures.keys().next();
    if (oldest.done) break;
    labelTextures.get(oldest.value)?.dispose();
    labelTextures.delete(oldest.value);
  }
  return texture;
}

type Props = {
  role: SampleRole;
  family?: string;
  sampleName?: string | null;
  fx?: FxSet;
  size?: number;
  glow?: number;
  castShadow?: boolean;
  highlight?: boolean;
  fade?: { current: number } | null;
};

export function Vinyl({
  role,
  family = 'kit',
  sampleName = null,
  fx,
  size = 1,
  glow = 0,
  castShadow = PERFORMANCE.shadows,
  highlight = false,
  fade = null,
}: Props) {
  const geometry = useRecordGeometry();
  const body = geometry.body;
  const resolvedFamily = useMemo(
    () => (sampleName ? gameSample(sampleName)?.family ?? family : family),
    [sampleName, family],
  );
  const label = useMemo(() => labelFor(role, resolvedFamily, sampleName), [role, resolvedFamily, sampleName]);
  const key = labelKey(role, resolvedFamily, sampleName);
  const mask = fxMask(fx);
  const fading = fade !== null;

  const emissiveIntensity = (0.55 + glow * 1.9) * (fx?.filter ? 0.6 : 1);
  const materials = useMemo(() => {
    const { fresh, at } = fading ? { fresh: 0, at: 0 } : freshMarks(key, mask);
    return createRecordMaterials({ role, key, label, fx: mask, fresh, freshAt: at, fading });
  }, [role, key, label, mask, fading]);
  useEffect(() => () => materials.dispose(), [materials]);
  materials.setGlow(emissiveIntensity);

  useFrame(() => {
    if (!fade) return;
    const opacity = Math.max(0, Math.min(1, fade.current));
    for (const material of [materials.body, materials.outline]) {
      material.opacity = opacity;
      material.depthWrite = opacity > 0.97;
    }
  });

  return (
    <group scale={size}>
      {PERFORMANCE.tier !== 'low' && <mesh geometry={body} material={materials.outline} />}
      {highlight && (
        <mesh geometry={body} material={recordAuraMaterial(LAYER_COLORS[role])} scale={[1.17, 2.8, 1.17]} renderOrder={4} />
      )}
      <mesh geometry={body} material={materials.body} castShadow={castShadow && !fading} />
      {fx?.wide && <mesh geometry={geometry.wings} material={materials.body} />}
      {fx?.space && <mesh geometry={geometry.spikes} material={materials.body} />}
      {fx?.reverb && !fading && (
        <mesh geometry={echoGeometry} material={echoMaterial} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} />
      )}
      {fx?.space && !fading && (
        <points geometry={spaceGeometry} material={spaceMaterial} rotation={[0.35, materials.turn, 0.2]} renderOrder={3} />
      )}
    </group>
  );
}

export { RECORD_RADIUS };
