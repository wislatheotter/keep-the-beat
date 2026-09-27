import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, RingGeometry, type Group, type Mesh } from 'three';
import { BLOCK_REST_Y, LAYER_COLORS, sample as gameSample, type BlockState } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { emitBurst } from '../sparks';
import { Vinyl } from './Vinyl';

const VANISH_SECONDS = 0.62;

const ringGeometry = new RingGeometry(0.62, 0.84, 40);

type Ghost = { block: BlockState; startAt: number };

export function VanishingRecords() {
  const state = useGameStateWhen((room) => [room.phase, room.matchStartedAt, Object.values(room.blocks).map((block) => [block.id, block.status])]);
  const runtime = useGameRuntime();
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const previous = useRef<{ round: number | null; playing: boolean; floor: BlockState[] }>({
    round: null, playing: false, floor: [],
  });

  useEffect(() => {
    const before = previous.current;
    previous.current = {
      round: state.matchStartedAt,
      playing: state.phase === 'playing',
      floor: Object.values(state.blocks).filter((block) => block.status === 'world'),
    };
    if (!before.playing || before.round !== state.matchStartedAt) return;
    const gone = before.floor.filter((block) => !state.blocks[block.id]);
    if (gone.length === 0) return;
    const now = runtime.now();
    setGhosts((list) => [...list, ...gone.map((block) => ({ block, startAt: now }))]);
  }, [state.blocks, state.phase, state.matchStartedAt, runtime]);

  if (ghosts.length === 0) return null;
  return (
    <>
      {ghosts.map((ghost) => (
        <VanishingRecord
          key={ghost.block.id}
          ghost={ghost}
          onDone={() => setGhosts((list) => list.filter((entry) => entry.block.id !== ghost.block.id))}
        />
      ))}
    </>
  );
}

function VanishingRecord({ ghost, onDone }: { ghost: Ghost; onDone: () => void }) {
  const runtime = useGameRuntime();
  const group = useRef<Group>(null);
  const body = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  const fade = useRef(1);
  const burst = useRef(false);
  const finished = useRef(false);
  const { block } = ghost;
  const color = LAYER_COLORS[block.role];
  const ringMaterial = useMemo(() => new MeshBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    forceSinglePass: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  }), [color]);
  useEffect(() => () => ringMaterial.dispose(), [ringMaterial]);

  useFrame((_, delta) => {
    const t = Math.max(0, (runtime.now() - ghost.startAt) / 1000);
    const at = block.position;
    if (!group.current || !body.current || !ring.current) return;

    if (!burst.current) {
      burst.current = true;
      const from = { x: at.x, y: BLOCK_REST_Y + 0.3, z: at.z };
      emitBurst(from, color, { count: 18, speed: 3.4, lift: 3.6, life: 0.75, size: 1.1 });
      emitBurst(from, '#ffffff', { count: 8, speed: 5.2, lift: 5, life: 0.45, size: 0.7 });
    }

    const p = Math.min(1, t / VANISH_SECONDS);
    if (p >= 1) {
      if (!finished.current) {
        finished.current = true;
        onDone();
      }
      group.current.visible = false;
      return;
    }

    const swell = p < 0.25 ? Math.sin((p / 0.25) * Math.PI / 2) : 1;
    const shrink = p < 0.25 ? 1 : 1 - ((p - 0.25) / 0.75) ** 2;
    const rise = 1 - (1 - p) ** 3;
    group.current.position.set(at.x, BLOCK_REST_Y + rise * 1.7, at.z);
    body.current.scale.setScalar(Math.max(0.001, (1 + swell * 0.42) * shrink));
    body.current.rotation.y += Math.min(delta, 0.05) * (7 + p * 26);
    body.current.rotation.x = p * 1.1;
    fade.current = 1 - p ** 1.6;

    ring.current.position.set(at.x, 0.03, at.z);
    ring.current.scale.setScalar(0.6 + (1 - (1 - p) ** 2) * 3.4);
    ringMaterial.opacity = 0.95 * (1 - p);
  });

  const entry = gameSample(block.sampleName);
  return (
    <>
      <mesh ref={ring} geometry={ringGeometry} material={ringMaterial} rotation={[-Math.PI / 2, 0, 0]} />
      <group ref={group} position={[block.position.x, BLOCK_REST_Y, block.position.z]}>
        <group ref={body}>
          <Vinyl role={block.role} sampleName={block.sampleName} family={entry?.family} fx={block.fx} glow={1} fade={fade} />
        </group>
      </group>
    </>
  );
}
