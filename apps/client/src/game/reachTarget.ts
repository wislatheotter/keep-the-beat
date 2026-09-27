import type { Vector3 } from 'three';
import { LOOP_LAYERS, platterPosition, type GameState, type Gesture } from '@loop/shared';
import { recordPose } from './scene/Handoff';

export function reachTarget(
  state: GameState,
  gesture: Gesture,
  record: string | null,
  from: { x: number; z: number },
  out: Vector3,
): boolean {
  if (gesture === 'grab' || gesture === 'grab-high' || gesture === 'catch') {
    const pose = record ? recordPose(record) : null;
    if (!pose) return false;
    out.copy(pose.position);
    return true;
  }
  if (gesture === 'place' || gesture === 'feed' || gesture === 'drop') {
    const block = record ? state.blocks[record] : null;
    if (!block) return false;
    out.set(block.position.x, block.position.y, block.position.z);
    return true;
  }
  if (gesture === 'eject') {
    let best = Infinity;
    for (const layer of LOOP_LAYERS) {
      const at = platterPosition(layer);
      const distance = Math.hypot(at.x - from.x, at.z - from.z);
      if (distance < best) {
        best = distance;
        out.set(at.x, at.y, at.z);
      }
    }
    return best < Infinity;
  }
  return false;
}
