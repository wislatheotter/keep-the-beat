import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { PERFORMANCE } from '../performance';
import { DEV_HANDLE } from '../../runtime/devFlag';
import { batchScenery, nextSceneryFrame } from './sceneryBatches';

export function SceneryBatcher() {
  const scene = useThree((three) => three.scene);

  useEffect(() => {
    if (!PERFORMANCE.batchScenery) return;
    const batched = batchScenery(scene);
    if (DEV_HANDLE) {
      const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
      handle.scenery = () => ({ batches: batched.batches, meshes: batched.meshes, refused: batched.refused, elsewhere: batched.elsewhere });
      (window as unknown as { __loop?: unknown }).__loop = handle;
    }
    return () => batched.dispose();
  }, [scene]);

  useFrame(() => nextSceneryFrame(), -100);

  return null;
}
