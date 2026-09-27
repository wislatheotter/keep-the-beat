import { useEffect } from 'react';
import { create } from 'zustand';

type Steer = { x: number; z: number };

export const useSteer = create<Steer>(() => ({ x: 0, z: 0 }));

export function steer(x: number, z: number) {
  const reach = Math.hypot(x, z);
  useSteer.setState(reach > 1 ? { x: x / reach, z: z / reach } : { x, z });
}

const KEY_PUSH: Record<string, readonly [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export function useKeyboardSteer(active = true) {
  useEffect(() => {
    if (!active) return;
    const held = new Set<string>();
    const apply = () => {
      let x = 0;
      let z = 0;
      for (const code of held) {
        const [px, pz] = KEY_PUSH[code]!;
        x += px;
        z += pz;
      }
      x = Math.sign(x);
      z = Math.sign(z);
      steer(x * (z ? Math.SQRT1_2 : 1), z * (x ? Math.SQRT1_2 : 1));
    };
    const press = (event: KeyboardEvent) => {
      if (event.repeat || !(event.code in KEY_PUSH)) return;
      held.add(event.code);
      apply();
    };
    const lift = (event: KeyboardEvent) => {
      if (!held.delete(event.code)) return;
      apply();
    };
    window.addEventListener('keydown', press);
    window.addEventListener('keyup', lift);
    return () => {
      window.removeEventListener('keydown', press);
      window.removeEventListener('keyup', lift);
      steer(0, 0);
    };
  }, [active]);
}
