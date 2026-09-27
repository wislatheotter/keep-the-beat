import { useFrame } from '@react-three/fiber';
import { useRef, useState } from 'react';
import { MathUtils, type Group, type Mesh, type ShaderMaterial } from 'three';
import {
  BLOCK_REST_Y,
  BlockFlight,
  FLOOR_LIFETIME_MS,
  FLOOR_WARNING_MS,
  LAYER_COLORS,
  RACK_SLOTS,
  STATION_BY_ID,
  rackContents,
  sample as gameSample,
  stationRotation,
  type BlockState,
  type GameState,
} from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { beatInfo } from '../beat';
import { BeaconBeam } from './BeaconBeam';
import { Vinyl, RECORD_RADIUS } from './Vinyl';
import { decorativeMotion } from '../motion';
import { SoftDisc } from './SoftDisc';
import { CRATE_TILT, STATION_SCALE, crateRestY, riseProgress } from '../crate';
import { useFocusStore } from '../interaction';
import { RecordPlace } from './Handoff';
import { finaleCut } from '../stage';

const RECORD_SHADOW = 0.2;

export function MusicBlock({ blockId, block: given }: {
  blockId: string;
  block?: BlockState;
}) {
  const state = useGameStateWhen((room) => {
    const found = room.blocks[blockId];
    return found && [
      found.status, found.role, found.sampleName, found.fx, found.beacon, found.slot, found.rackId, found.stationId,
      found.status === 'racked' && found.rackId ? rackContents(room, found.rackId).length : 0,
    ];
  });
  const seen = useRef<BlockState | null>(null);
  seen.current = given ?? state.blocks[blockId] ?? seen.current;
  if (!seen.current) return null;
  return <Record blockId={blockId} given={given} state={state} block={seen.current} />;
}

function Record({ blockId, given, state, block }: {
  blockId: string;
  given: BlockState | undefined;
  state: GameState;
  block: BlockState;
}) {
  const runtime = useGameRuntime();
  const ref = useRef<Group>(null);
  const shadow = useRef<Group>(null);
  const body = useRef<Group>(null);
  const beacon = useRef<Mesh>(null);

  const flight = useRef(new BlockFlight());

  const [expiring, setExpiring] = useState(false);
  const fade = useRef(1);
  const flicker = useRef(0);

  const racked = block.status === 'racked';
  const rack = racked && block.rackId ? STATION_BY_ID[block.rackId] : null;
  const crateSize = racked && block.rackId ? (given ? RACK_SLOTS : rackContents(state, block.rackId).length) : 0;
  const spin = useRef(0);
  const processed = useRef(false);
  const outputHover = useRef(0);
  if (block.status === 'station') { processed.current = true; outputHover.current = 0; }
  else if (block.status === 'held' || block.status === 'deck' || racked) processed.current = false;
  const focused = useFocusStore((store) => store.focus.blockId === block.id);

  useFrame((_, delta) => {
    const state = runtime.getState();
    const block = given ?? state.blocks[blockId];
    const group = ref.current;
    if (!group || !block) return;
    const now = runtime.now();
    if (state.phase === 'complete') {
      group.visible = !finaleCut(state, now);
      if (shadow.current) shadow.current.visible = false;
      return;
    }
    const beat = beatInfo(state, now);
    const thrown = block.status === 'thrown';

    if (racked) {
      const rise = riseProgress(block, block.rackId ? state.stations[block.rackId] : undefined, now);
      const rest = crateRestY(crateSize);
      const t = Math.max(0, rise);
      const hop = rise < 1 ? 4 * t * (1 - t) * 0.5 : 0;
      const settle = rise >= 1 ? 0 : (1 - t) * -0.14;
      const bob = Math.sin(beat.barPhase * Math.PI * 2) * 0.018 * decorativeMotion();
      group.position.set(block.position.x, rest + hop + settle + bob, block.position.z);
      group.visible = rise >= 0;
      spin.current += Math.min(delta, 0.05) * (focused ? 0.25 : 0.55) * decorativeMotion();
      if (body.current) {
        const flip = rise < 1 ? MathUtils.smootherstep(t, 0.05, 0.85) * Math.PI * 2 : 0;
        body.current.rotation.set(flip, spin.current, 0);
        const pop = rise < 1 ? 0.55 + 0.45 * MathUtils.smoothstep(t, 0, 0.35) : 1;
        body.current.scale.setScalar(pop * (1 + beat.pulse * 0.04 + (focused ? 0.05 : 0)));
        body.current.position.y += ((focused ? 0.06 : 0) - body.current.position.y) * Math.min(1, delta * 12);
      }
      if (shadow.current) shadow.current.visible = false;
      if (beacon.current) {
        (beacon.current.material as ShaderMaterial).uniforms.uOpacity!.value = 0;
      }
      return;
    }

    const position = flight.current.advance(
      { position: block.position, velocity: block.velocity, airborne: thrown },
      delta,
    );
    let hover = block.beacon ? 0.16 + Math.sin(beat.barPhase * Math.PI * 2) * 0.05 : 0;
    if (processed.current) {
      outputHover.current += ((thrown ? 0 : hover) - outputHover.current) * Math.min(1, delta * 8);
      hover = outputHover.current;
    }
    group.position.set(position.x, position.y + hover, position.z);
    group.visible = true;

    const dt = Math.min(delta, 0.05);

    const left = block.status === 'world' ? FLOOR_LIFETIME_MS - (now - block.floorSince) : Infinity;
    const warning = left < FLOOR_WARNING_MS;
    if (warning !== expiring) setExpiring(warning);
    if (warning) {
      const urgency = Math.min(1, Math.max(0, 1 - left / FLOOR_WARNING_MS));
      flicker.current += dt * Math.PI * 2 * (1.4 + urgency * 5.2);
      const dip = Math.max(0, Math.sin(flicker.current)) ** 2;
      fade.current = 1 - dip * (0.55 + urgency * 0.25);
    } else {
      flicker.current = 0;
      fade.current = 1;
    }

    if (body.current) {
      body.current.rotation.z = 0;
      if (thrown) {
        body.current.rotation.x += dt * 7.5;
        body.current.rotation.y += dt * 4.2;
      } else {
        body.current.rotation.x *= Math.exp(-dt * 6);
        body.current.rotation.y += dt * (block.beacon ? 1.15 : 0.32);
      }
      const punch = block.beacon ? beat.pulse : beat.pulse * 0.35;
      body.current.scale.setScalar(1 + punch * (block.beacon ? 0.16 : 0.05));
    }

    if (shadow.current) {
      const height = Math.max(0, position.y - BLOCK_REST_Y);
      shadow.current.position.set(position.x, 0.012, position.z);
      const spread = 1 + height * 0.16;
      shadow.current.scale.setScalar(spread);
      shadow.current.visible = height < 6;
      const disc = shadow.current.children[0] as Mesh | undefined;
      const uniform = (disc?.material as ShaderMaterial | undefined)?.uniforms?.uOpacity;
      if (uniform) uniform.value = RECORD_SHADOW / (spread * spread) ** 0.5;
    }

    if (beacon.current) {
      const flare = 1 + beat.pulse * 0.35;
      beacon.current.scale.set(flare, 1, flare);
      const strength = block.beacon ? 1 : LOOSE_BEAM_STRENGTH;
      (beacon.current.material as ShaderMaterial).uniforms.uOpacity!.value =
        (0.26 + beat.pulse * 0.26) * strength * fade.current;
    }
  });

  if (block.status === 'held' || block.status === 'station' || block.status === 'deck') return null;
  const color = LAYER_COLORS[block.role];
  const entry = gameSample(block.sampleName);

  if (racked) {
    if (block.slot !== 0) return null;
    const yaw = rack ? stationRotation(rack) : 0;
    return (
      <group ref={ref} position={[block.position.x, block.position.y, block.position.z]} visible={false}>
        <group rotation={[0, yaw, 0]}>
          <group rotation={[CRATE_TILT, 0, 0]}>
            <group ref={body}>
              <RecordPlace id={block.id}>
                <Vinyl role={block.role} sampleName={block.sampleName} family={entry?.family} fx={block.fx} size={STATION_SCALE} glow={focused ? 0.55 : 0.3} />
                {focused && <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[RECORD_RADIUS * STATION_SCALE * 1.12, .018, 6, 48]} />
                  <meshBasicMaterial color={color} toneMapped={false} />
                </mesh>}
              </RecordPlace>
            </group>
          </group>
        </group>
      </group>
    );
  }

  return (
    <>
      <group ref={shadow}>
        <SoftDisc radius={0.92} opacity={RECORD_SHADOW} y={0} />
      </group>
      <group ref={ref} position={[block.position.x, block.position.y, block.position.z]}>
        <group ref={body}>
          <RecordPlace id={block.id}>
            <Vinyl role={block.role} sampleName={block.sampleName} family={entry?.family} fx={block.fx} glow={focused ? 0.8 : block.beacon ? 0.55 : 0.22} highlight={focused} fade={expiring ? fade : null} />
          </RecordPlace>
        </group>
        <BeaconBeam
          ref={beacon}
          color={color}
          strength={block.beacon ? 1 : LOOSE_BEAM_STRENGTH}
        />
      </group>
    </>
  );
}



const LOOSE_BEAM_STRENGTH = 0.42;
