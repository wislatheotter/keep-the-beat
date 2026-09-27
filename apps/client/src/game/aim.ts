import { create } from 'zustand';
import { LOB_POWER_UNDRAGGED, type Vec3 } from '@loop/shared';

type Aim = {
  aiming: boolean;
  heading: Vec3;
  power: number;
  mouse: boolean;
};

const idle: Aim = { aiming: false, heading: { x: 0, y: 0, z: -1 }, power: LOB_POWER_UNDRAGGED, mouse: false };

export const useAimStore = create<Aim>(() => idle);

export function aimAt(heading: Vec3, power: number, mouse = false) {
  useAimStore.setState({ aiming: true, heading, power, mouse });
}

export function lobOrigin(position: Vec3, heading: Vec3): Vec3 {
  return { x: position.x + heading.x * 0.45, y: 1.72, z: position.z + heading.z * 0.45 };
}

export function cancelAim() {
  if (useAimStore.getState().aiming) useAimStore.setState(idle);
}

export const mousePointer = { seen: false, x: 0, y: 0 };
