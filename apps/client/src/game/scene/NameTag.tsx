import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MathUtils, Vector3, type Group } from 'three';
import { easeOutBack } from '../stage';

const PILL_HEIGHT = 0.36;
const PILL_PX = 56;
const MIN_PX = 20;
const MAX_PX = 40;

const layers = new WeakMap<HTMLElement, HTMLDivElement>();
function tagLayer(host: HTMLElement) {
  let layer = layers.get(host);
  if (!layer || layer.parentElement !== host) {
    layer = document.createElement('div');
    layer.className = 'world-tags';
    host.append(layer);
    layers.set(host, layer);
  }
  return layer;
}

const at = new Vector3();
const above = new Vector3();
const cameraUp = new Vector3();

export function NameTag({
  name,
  chip = null,
  height = 1.65,
  visibility,
}: {
  name: string | null;
  chip?: string | null;
  height?: number;
  visibility: { current: number };
}) {
  const host = useThree((three) => three.gl.domElement.parentElement);
  const anchor = useRef<Group>(null);
  const element = useMemo(() => {
    const node = document.createElement('div');
    node.className = 'world-tag';
    node.setAttribute('aria-hidden', 'true');
    node.style.display = 'none';
    node.append(document.createElement('b'), document.createElement('i'));
    return node;
  }, []);

  useEffect(() => {
    if (host) tagLayer(host).append(element);
    return () => element.remove();
  }, [host, element]);

  useEffect(() => {
    const [nameNode, chipNode] = element.children as unknown as [HTMLElement, HTMLElement];
    nameNode.textContent = name ?? '';
    nameNode.style.display = name ? '' : 'none';
    chipNode.textContent = chip ?? '';
    chipNode.style.display = chip ? '' : 'none';
  }, [element, name, chip]);

  const written = useMemo(() => ({ shown: false, z: NaN, opacity: NaN, left: NaN, top: NaN, scale: NaN }), []);

  useFrame((three) => {
    const shown = MathUtils.clamp(visibility.current, 0, 1);
    const hide = () => {
      if (!written.shown) return;
      written.shown = false;
      element.style.display = 'none';
    };
    if (!anchor.current || shown <= 0.01 || (!name && !chip)) {
      hide();
      return;
    }
    anchor.current.getWorldPosition(at);
    const { camera, size } = three;
    cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    above.copy(at).add(cameraUp).project(camera);
    at.project(camera);
    if (at.z > 1 || at.z < -1) {
      hide();
      return;
    }
    const perUnit = Math.hypot((above.x - at.x) * size.width / 2, (above.y - at.y) * size.height / 2);
    const pill = MathUtils.clamp(perUnit * PILL_HEIGHT, MIN_PX, MAX_PX);
    const pop = Math.max(0.001, easeOutBack(shown, 1.8));
    const left = Math.round((at.x + 1) * size.width * 5) / 10;
    const top = Math.round((1 - at.y) * size.height * 5) / 10;
    const scale = Math.round((pill / PILL_PX) * pop * 1e4) / 1e4;
    const z = Math.round((1 - at.z) * 1e5);
    const opacity = Math.round(Math.min(1, shown * 1.4) * 1000) / 1000;
    if (!written.shown) {
      written.shown = true;
      element.style.display = '';
    }
    if (z !== written.z) {
      written.z = z;
      element.style.zIndex = String(z);
    }
    if (opacity !== written.opacity) {
      written.opacity = opacity;
      element.style.opacity = String(opacity);
    }
    if (left !== written.left || top !== written.top || scale !== written.scale) {
      written.left = left;
      written.top = top;
      written.scale = scale;
      element.style.transform = `translate(${left}px, ${top}px) translate(-50%, -100%) scale(${scale})`;
    }
  });

  return <group ref={anchor} position={[0, height, 0]} />;
}
