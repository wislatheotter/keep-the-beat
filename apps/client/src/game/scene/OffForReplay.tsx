import { useFrame } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import type { Group, Light } from 'three';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { finaleCut } from '../stage';

export function OffForReplay({ children }: { children: ReactNode }) {
  const runtime = useGameRuntime();
  const root = useRef<Group>(null);
  const standIns = useRef<Group>(null);
  useFrame(() => {
    const node = root.current;
    const stand = standIns.current;
    if (!node || !stand) return;
    const off = finaleCut(runtime.getState(), runtime.now());
    if (off === !node.visible) return;
    if (off) {
      stand.clear();
      node.traverseVisible((object) => {
        const light = object as Light;
        if (!light.isLight) return;
        const twin = new (light.constructor as new () => Light)();
        twin.intensity = 0;
        twin.castShadow = light.castShadow;
        twin.layers.mask = light.layers.mask;
        stand.add(twin);
      });
    }
    node.visible = !off;
    stand.visible = off;
  });
  return (
    <>
      <group ref={root}>{children}</group>
      <group ref={standIns} visible={false} />
    </>
  );
}
