import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, Color, InstancedMesh, MeshBasicMaterial, Object3D, TetrahedronGeometry } from 'three';
import {
  DECK_POSITION,
  LAYER_COLORS,
  MACHINE_ACCENTS,
  PLATTER_Y,
  STATIONS,
  STATION_BY_ID,
  platterPosition,
  stationExit,
  stationPosition,
  rackSlotPosition,
  type GameEvent,
  type LoopLayer,
  type StationKind,
} from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { SPARK_COUNT, emitBurst, sparks } from '../sparks';

const GRAVITY = 9.5;
const dummy = new Object3D();
const HIDDEN = -50;

export function Sparks() {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new TetrahedronGeometry(0.1, 0), []);
  const material = useMemo(() => new MeshBasicMaterial({
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  }), []);

  useEffect(() => {
    if (!mesh.current) return;
    for (let i = 0; i < SPARK_COUNT; i += 1) mesh.current.setColorAt(i, WHITE);
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, []);

  useFrame((_, delta) => {
    const instances = mesh.current;
    if (!instances) return;
    const dt = Math.min(delta, 0.05);
    let touched = false;

    for (let i = 0; i < SPARK_COUNT; i += 1) {
      const spark = sparks[i]!;
      if (spark.life <= 0) {
        if (spark.y !== HIDDEN) {
          spark.y = HIDDEN;
          dummy.position.set(0, HIDDEN, 0);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          instances.setMatrixAt(i, dummy.matrix);
          touched = true;
        }
        continue;
      }

      spark.life -= dt;
      spark.vy -= GRAVITY * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.z += spark.vz * dt;
      const drag = Math.pow(0.12, dt);
      spark.vx *= drag;
      spark.vz *= drag;

      const remaining = Math.max(0, spark.life / spark.maxLife);
      dummy.position.set(spark.x, spark.y, spark.z);
      dummy.rotation.set(spark.x * 3 + spark.life * 9, spark.z * 3, 0);
      dummy.scale.setScalar(spark.size * (0.25 + remaining * 0.9));
      dummy.updateMatrix();
      instances.setMatrixAt(i, dummy.matrix);
      instances.setColorAt(i, spark.color);
      touched = true;
    }

    if (touched) {
      instances.instanceMatrix.needsUpdate = true;
      if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
    }
  });

  return <instancedMesh ref={mesh} args={[geometry, material, SPARK_COUNT]} frustumCulled={false} />;
}

const WHITE = new Color('#ffffff');

export function StageSparks() {
  const state = useGameStateWhen((room) => room.lastEvent?.id);
  const runtime = useGameRuntime();
  const lastFired = useRef<string | null>(null);

  useEffect(() => {
    const event = state.lastEvent;
    if (!event || event.id === lastFired.current) return;
    lastFired.current = event.id;
    if (runtime.now() - event.at > 400) return;
    fireStageSparks(event);
  }, [state.lastEvent, runtime]);

  return null;
}

const layerSpot = (layer: LoopLayer) => platterPosition(layer);

export function fireStageSparks(event: GameEvent) {
  switch (event.type) {
    case 'dropped': {
      for (const layer of event.layers) {
        const at = layerSpot(layer);
        emitBurst(
          { x: at.x, y: PLATTER_Y + 0.6, z: at.z },
          LAYER_COLORS[layer],
          event.coordinated
            ? { count: 30, speed: 5.0, lift: 4.2, life: 0.75, size: 1.2 }
            : { count: 20, speed: 3.6, lift: 3.2, life: 0.6 },
        );
      }
      return;
    }
    case 'overtime': {
      emitBurst({ x: DECK_POSITION.x, y: 1.4, z: DECK_POSITION.z }, '#ff3b5c', { count: 34, speed: 7.2, lift: 1.6, life: 0.9, size: 1.2 });
      return;
    }
    case 'section-printed': {
      for (const definition of STATIONS) {
        if (definition.kind !== 'rack') continue;
        const at = rackSlotPosition(definition, 0);
        emitBurst(
          { x: at.x, y: 1.6, z: at.z },
          definition.role ? LAYER_COLORS[definition.role] : '#ffffff',
          { count: 14, speed: 3.0, lift: 3.6, life: 0.7 },
        );
      }
      return;
    }
    case 'processed': {
      const definition = STATION_BY_ID[event.stationId];
      if (!definition) return;
      const at = stationExit(definition);
      emitBurst(
        { x: at.x, y: 1.3, z: at.z },
        MACHINE_ACCENTS[definition.kind as Exclude<StationKind, 'rack'>] ?? '#8fe9ff',
        event.kind === 'crusher'
          ? { count: 22, speed: 5.2, lift: 2.4, life: 0.5, size: 1.2 }
          : { count: 16, speed: 2.4, lift: 3.0, life: 0.85 },
      );
      return;
    }
    case 'taken': {
      const definition = STATION_BY_ID[event.rackId];
      if (!definition) return;
      const at = rackSlotPosition(definition, 0);
      emitBurst(
        { x: at.x, y: at.y + 0.1, z: at.z },
        LAYER_COLORS[event.role],
        { count: 12, speed: 2.6, lift: 2.6, life: 0.5 },
      );
      return;
    }
    default:
      return;
  }
}
