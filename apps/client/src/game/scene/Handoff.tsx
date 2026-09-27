import { useFrame } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import { Quaternion, Vector3, type Group } from 'three';
import { DEV_HANDLE } from '../../runtime/devFlag';

type Pose = { position: Vector3; quaternion: Quaternion; scale: number; at: number };

const poses = new Map<string, Pose>();
const arrivals = new Map<string, number>();
const scale = new Vector3();

export function recordPose(id: string, clock = performance.now()): Pose | null {
  const pose = poses.get(id);
  return pose && clock - pose.at < 250 ? pose : null;
}

if (DEV_HANDLE) {
  const handle = ((window as unknown as { __loop?: Record<string, unknown> }).__loop ??= {});
  handle.recordPose = (id: string) => poses.get(id) ?? null;
}

export function holdBack(id: string, until: number) {
  arrivals.set(id, until);
}

function heldBack(id: string, clock: number) {
  const until = arrivals.get(id);
  if (until === undefined) return false;
  if (clock < until) return true;
  arrivals.delete(id);
  return false;
}

export function RecordPlace({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const group = ref.current;
    if (!group) return;
    const clock = performance.now();
    group.visible = !heldBack(id, clock);
    let pose = poses.get(id);
    if (!pose) {
      pose = { position: new Vector3(), quaternion: new Quaternion(), scale: 1, at: 0 };
      poses.set(id, pose);
    }
    group.updateWorldMatrix(true, false);
    group.matrixWorld.decompose(pose.position, pose.quaternion, scale);
    pose.scale = scale.x;
    pose.at = clock;
  });
  return <group ref={ref}>{children}</group>;
}
