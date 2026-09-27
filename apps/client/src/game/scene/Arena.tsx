import { useRef } from 'react';
import { DoubleSide, MeshStandardMaterial } from 'three';
import { useFrame } from '@react-three/fiber';
import { ARENA_RADIUS, CROWD_FLOOR_Y, CROWD_RADIUS, theme } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { DiscoFloor } from './DiscoFloor';
import { Crowd } from './Crowd';
import { DiscoBall } from './DiscoBall';
import { Venue } from './Venue';
import { VenueShow } from './VenueShow';
import { OffForReplay } from './OffForReplay';
import { beatInfo, showEnergy } from '../beat';

export function Arena() {
  const STAGE_LIFT = -CROWD_FLOOR_Y;
  const runtime = useGameRuntime();
  const state = useGameStateWhen((room) => room.themeId);
  const vibe = theme(state.themeId);

  return (
    <group>
      <OffForReplay>
        <mesh position={[0, -STAGE_LIFT - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[CROWD_RADIUS + 16, 64]} />
          <meshStandardMaterial color="#141025" roughness={0.94} metalness={0.02} envMapIntensity={0.2} />
        </mesh>

        <Crowd />

        <mesh position={[0, -STAGE_LIFT / 2, 0]}>
          <cylinderGeometry args={[ARENA_RADIUS + 0.35, ARENA_RADIUS + 0.5, STAGE_LIFT, 72, 1, true]} />
          <meshStandardMaterial color="#0d111b" roughness={0.72} metalness={0.25} side={DoubleSide} envMapIntensity={0.4} />
        </mesh>
      </OffForReplay>

      <DiscoFloor />
      <OffForReplay>
        <StageRim accent={vibe.look.accent} />
        <Venue />
        <DiscoBall />
      </OffForReplay>
      <VenueShow />
    </group>
  );
}

function StageRim({ accent }: { accent: string }) {
  const runtime = useGameRuntime();
  const material = useRef<MeshStandardMaterial>(null);

  useFrame(() => {
    const state = runtime.getState();
    if (!material.current) return;
    const now = runtime.now();
    const bar = beatInfo(state, now).barPhase;
    material.current.emissiveIntensity = 0.8 + showEnergy(state, now) * 0.7 + Math.sin(bar * Math.PI * 2) * 0.24;
  });

  return (
    <group>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[ARENA_RADIUS - 0.13, ARENA_RADIUS + 0.12, 96]} />
        <meshStandardMaterial
          ref={material}
          color={accent}
          emissive={accent}
          emissiveIntensity={1.1}
          roughness={0.35}
          metalness={0.2}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, -0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[ARENA_RADIUS + 0.3, ARENA_RADIUS + 0.55, 96]} />
        <meshStandardMaterial color="#12161f" roughness={0.6} metalness={0.4} />
      </mesh>
    </group>
  );
}
