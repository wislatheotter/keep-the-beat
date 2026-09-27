import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Color, Vector3, type PointLight } from 'three';
import { LAYER_COLORS, type BlockState, type PlayerState } from '@loop/shared';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { PERFORMANCE } from '../performance';
import { finaleCut } from '../stage';

const POOL = PERFORMANCE.tier === 'low' ? 2 : 4;

const LOOSE_INTENSITY = PERFORMANCE.looseRecordLights ? 1.6 : 0;
const BEACON_INTENSITY = 3.2;

export function RecordLights() {
  const runtime = useGameRuntime();
  const lights = useRef<Array<PointLight | null>>([]);
  const owners = useRef<Array<string | null>>(Array.from({ length: POOL }, () => null));
  const colour = useRef(new Color());

  useFrame((_, delta) => {
    const state = runtime.getState();
    if (finaleCut(state, runtime.now())) {
      for (let i = 0; i < POOL; i += 1) {
        owners.current[i] = null;
        const light = lights.current[i];
        if (light) light.intensity = 0;
      }
      return;
    }
    const me = state.players[runtime.playerId];
    let found = 0;
    for (const id in state.blocks) {
      const block = state.blocks[id]!;
      if (block.status !== 'world' && block.status !== 'thrown') continue;
      if (!block.beacon && LOOSE_INTENSITY === 0) continue;
      const score = rank(block, me);
      let at = found < POOL ? found : POOL;
      while (at > 0 && score < scores[at - 1]!) {
        if (at < POOL) { best[at] = best[at - 1]!; scores[at] = scores[at - 1]!; }
        at -= 1;
      }
      if (at < POOL) {
        best[at] = block.id;
        scores[at] = score;
        if (found < POOL) found += 1;
      }
    }
    const wanted = (id: string) => {
      for (let k = 0; k < found; k += 1) if (best[k] === id) return true;
      return false;
    };

    for (let i = 0; i < POOL; i += 1) {
      if (owners.current[i] && !wanted(owners.current[i]!)) owners.current[i] = null;
    }
    for (let k = 0; k < found; k += 1) {
      const id = best[k]!;
      if (owners.current.includes(id)) continue;
      const free = owners.current.indexOf(null);
      if (free >= 0) owners.current[free] = id;
    }

    const ease = 1 - Math.exp(-delta * 10);
    for (let i = 0; i < POOL; i += 1) {
      const light = lights.current[i];
      if (!light) continue;
      const block = owners.current[i] ? state.blocks[owners.current[i]!] : null;
      if (!block) {
        light.intensity += (0 - light.intensity) * ease;
        continue;
      }
      const target = block.beacon ? BEACON_INTENSITY : LOOSE_INTENSITY;
      const jumped = Math.hypot(light.position.x - block.position.x, light.position.z - block.position.z) > 3;
      if (jumped) light.position.set(block.position.x, block.position.y + 0.6, block.position.z);
      else light.position.lerp(scratch.set(block.position.x, block.position.y + 0.6, block.position.z), ease);
      light.color.lerp(colour.current.set(LAYER_COLORS[block.role]), jumped ? 1 : ease);
      light.distance = block.beacon ? 5.2 : 3.4;
      light.intensity += (target - light.intensity) * ease;
    }
  });

  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <pointLight
          key={i}
          ref={(node) => { lights.current[i] = node; }}
          intensity={0}
          distance={5.2}
          decay={2}
          position={[0, -5, 0]}
        />
      ))}
    </>
  );
}

const scratch = new Vector3();

const best: string[] = Array.from({ length: POOL }, () => '');
const scores = new Float64Array(POOL);

function rank(block: BlockState, me: PlayerState | undefined) {
  const distance = me ? Math.hypot(block.position.x - me.position.x, block.position.z - me.position.z) : 0;
  return (block.beacon ? 0 : 1e6) + distance;
}
