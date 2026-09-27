import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import {
  LAYER_COLORS,
  MACHINE_ACCENTS,
  STATIONS,
  TUNNEL_HALF,
  stationPosition,
  stationRotation,
  type StationDefinition,
} from '@loop/shared';
import { useGameRuntime, useGameSelector } from '../../runtime/GameRuntimeContext';
import { auraPulse, createAuraMaterial, fadeAura } from '../aura';
import { useFocusStore } from '../interaction';
import { RecordStation } from './RecordStation';
import { MachineStation } from './MachineStation';

export function Stations() {
  return (
    <>
      {STATIONS.map((definition) => (
        <Station key={definition.id} definition={definition} />
      ))}
    </>
  );
}

function Station({ definition }: { definition: StationDefinition }) {
  const station = useGameSelector((state) => state.stations[definition.id]);
  const at = stationPosition(definition);
  if (!station) return null;

  const accent = definition.role
    ? LAYER_COLORS[definition.role]
    : MACHINE_ACCENTS[definition.kind as Exclude<StationDefinition['kind'], 'rack'>];

  return (
    <group position={[at.x, 0, at.z]} rotation={[0, stationRotation(definition), 0]}>
      {definition.kind === 'rack' && <RecordStation definition={definition} station={station} />}
      {definition.kind !== 'rack' && <MachineStation definition={definition} station={station} accent={accent} />}
      {definition.kind !== 'rack' && <MachineHalo stationId={definition.id} accent={accent} halfLength={definition.kind === 'echo' ? TUNNEL_HALF + 0.5 : 0} />}
    </group>
  );
}

function MachineHalo({ stationId, accent, halfLength }: { stationId: string; accent: string; halfLength: number }) {
  const runtime = useGameRuntime();
  const focused = useFocusStore((store) => store.focus.stationId === stationId);
  const material = useMemo(() => createAuraMaterial(accent), [accent]);
  useFrame((_, delta) => {
    fadeAura(material, focused ? auraPulse(runtime.now()) : 0, delta);
  });
  return (
    <group position={[0, 0.03, 0]} scale={[1 + halfLength / 1.7, 1, 1]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} material={material}>
        <ringGeometry args={[1.62, 1.86, 48]} />
      </mesh>
    </group>
  );
}
