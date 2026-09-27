import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  Color,
  type Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type PointLight,
  Quaternion,
  Vector3,
} from 'three';
import {
  LAYER_COLORS,
  STATION_HANDOFF_AT,
  isGenericMachine,
  type GenericMachineKind,
  TUNNEL_HALF,
  clamp,
  sample as gameSample,
  stationAvailability,
  stationExit,
  stationPosition,
  stationRotation,
  theme,
  type FxId,
  type GameState,
  type StationDefinition,
  type StationKind,
  type StationState,
  type ThemeLook,
} from '@loop/shared';
import { useGameRuntime, useGameSelector, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { useLobbyStage } from '../lobbyStage';
import { decorativeMotion } from '../motion';
import { eyeOpenness } from '../stationPersonality';
import { PERFORMANCE } from '../performance';
import { beatInfo, showEnergy, type BeatInfo } from '../beat';
import { livePlayer } from '../interaction';
import { easeOutBack } from '../stage';
import { RecordPlace } from './Handoff';
import { Vinyl } from './Vinyl';
import { Spring, bump, punch, windUp } from './machineMotion';
import { markScenery } from './sceneryBatches';
import { isTrim, paintTrim, stageTrim } from './stageTrim';

export const MACHINES_FILE = '/stations/machines.glb';
const DRACO_DECODER = '/draco/';

type MachineKind = Exclude<StationKind, 'rack'>;
const MODEL: Record<MachineKind, string> = { echo: 'ECHO', crusher: 'CRUSHER', filter: 'FILTER',
  space: 'SPACE', wide: 'WIDE', swirl: 'SWIRL', warp: 'WARP', washer: 'WASHER' };
const FX: Partial<Record<MachineKind, FxId>> = {
  echo: 'reverb', crusher: 'crush', filter: 'filter',
  space: 'space', wide: 'wide', swirl: 'swirl', warp: 'warp',
};

const SCALE: Record<MachineKind, number> = { echo: 1, crusher: 1.15, filter: 1.2,
  space: 1, wide: 1, swirl: 1, warp: 1, washer: 1 };

const ECHO_RECORD_Y = 1.15;
const CRUSHER_RECORD_Y = 1.02 * SCALE.crusher;
const CRUSHER_STROKE = 0.97;
const FILTER_RECORD_Y = 2.45 * SCALE.filter;
const FILTER_DIP = 0.47 * SCALE.filter;

type Kind = 'Body' | 'Accent' | 'Glow' | 'Pulse' | 'Dark' | 'Metal' | 'Brass' | 'Cream' | 'Hazard' | 'Ring' | 'Wave';
type Materials = Record<Kind, MeshStandardMaterial>;

const BODY: Record<MachineKind, string> = { echo: '#24aaca', crusher: '#fa6d36', filter: '#9668de',
  space: '#5a9fea', wide: '#e8b540', swirl: '#31bda6', warp: '#cd68b4', washer: '#62c7dd' };

function createMaterials(kind: MachineKind, look: ThemeLook, accent: string): Materials {
  const body = new Color(BODY[kind]);
  const light = new Color(accent);
  const standard = (hex: Color | string, roughness: number, metalness = 0) => new MeshStandardMaterial({
    color: hex, roughness, metalness, envMapIntensity: 0.9,
  });
  const bodyMaterial = standard(body, 0.3, 0.25);
  bodyMaterial.emissive = body.clone();
  bodyMaterial.emissiveIntensity = 0.12;
  const glow = standard(light, 0.4);
  glow.emissive = light.clone();
  glow.emissiveIntensity = 1.2;
  glow.toneMapped = false;
  const pulse = standard(light.clone().lerp(new Color('#ffffff'), 0.55), 0.4);
  pulse.emissive = light.clone();
  pulse.emissiveIntensity = 0.5;
  pulse.toneMapped = false;
  const wave = new MeshStandardMaterial({
    color: light, emissive: light, emissiveIntensity: 1.6, transparent: true, opacity: 0,
    depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  });
  const trim = stageTrim(look);
  return {
    Body: bodyMaterial,
    Accent: standard(body.clone().lerp(new Color('#ffffff'), 0.6), 0.5),
    Glow: glow,
    Pulse: pulse,
    Dark: trim.Dark,
    Metal: trim.Metal,
    Brass: trim.Brass,
    Cream: trim.Cream,
    Hazard: trim.Hazard,
    Ring: glow.clone(),
    Wave: wave,
  };
}

type Rest = { position: Vector3; quaternion: Quaternion; scale: Vector3 };
type Model = {
  root: Object3D;
  parts: Map<string, Object3D>;
  rest: Map<string, Rest>;
  materials: Materials;
  own: Map<string, MeshStandardMaterial>;
};

const OWN_MATERIAL = /^(Ring|Wave)\d$/;

function useMachineModel(kind: MachineKind, look: ThemeLook, accent: string): Model {
  const { scene } = useGLTF(MACHINES_FILE, DRACO_DECODER) as unknown as { scene: Group };
  const prefix = MODEL[kind];
  const model = useMemo(() => {
    const source = scene.getObjectByName(`Machine_${prefix}`);
    if (!source) throw new Error(`machines.glb has no Machine_${prefix}`);
    const root = markScenery(source.clone(true));
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    const materials = createMaterials(kind, look, accent);
    const parts = new Map<string, Object3D>();
    const rest = new Map<string, Rest>();
    const own = new Map<string, MeshStandardMaterial>();
    root.traverse((child) => {
      if (!child.name.startsWith(`${prefix}_`)) return;
      const part = child.name.slice(prefix.length + 1);
      parts.set(part, child);
      rest.set(part, { position: child.position.clone(), quaternion: child.quaternion.clone(), scale: child.scale.clone() });
    });
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const name = (object.material as { name?: string }).name ?? '';
      const kindName = (name.includes('.') ? name.split('.')[1] : name) as Kind;
      const owner = object.name.startsWith(`${prefix}_`) ? object : object.parent;
      const part = owner?.name.slice(prefix.length + 1) ?? '';
      if (OWN_MATERIAL.test(part) && (kindName === 'Ring' || kindName === 'Wave')) {
        const material = materials[kindName].clone();
        own.set(part, material);
        object.material = material;
      } else {
        object.material = materials[kindName] ?? materials.Dark;
      }
      object.castShadow = PERFORMANCE.shadows && part === 'Static';
      object.receiveShadow = kindName !== 'Wave';
    });
    return { root, parts, rest, materials, own };
  }, [scene, prefix, kind]);
  useEffect(() => paintTrim(look), [look]);
  useEffect(() => () => {
    for (const material of Object.values(model.materials)) if (!isTrim(material)) material.dispose();
    for (const material of model.own.values()) material.dispose();
  }, [model]);
  return model;
}

function jobProgress(station: StationState, now: number) {
  if (!station.busyUntil || now >= station.busyUntil) return 0;
  const span = station.busyUntil - station.busySince;
  if (span <= 0) return 0;
  return clamp((now - station.busySince) / span, 0, 1);
}

function effectOnDeck(state: GameState, fx: FxId) {
  return Object.values(state.song.layers).some((layer) => layer.sampleName && layer.fx[fx]);
}

function useStationBlock(station: StationState) {
  const blockId = station.blockId;
  return useGameSelector((state) => {
    const block = blockId ? state.blocks[blockId] : undefined;
    return block && block.status === 'station' ? block : null;
  });
}

const tmpQ = new Quaternion();
const tmpV = new Vector3();
const inverseBody = new Matrix4();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const smooth = MathUtils.smoothstep;

function pose(model: Model, name: string, axis?: Vector3, angle = 0): Object3D | null {
  const part = model.parts.get(name);
  const rest = model.rest.get(name);
  if (!part || !rest) return null;
  part.position.copy(rest.position);
  part.scale.copy(rest.scale);
  part.quaternion.copy(rest.quaternion);
  if (axis && angle) part.quaternion.multiply(tmpQ.setFromAxisAngle(axis, angle));
  return part;
}

function restMachine(model: Model, body: Group | null, rig: Rig) {
  for (const name of model.parts.keys()) pose(model, name);
  const arrow = model.parts.get('Arrow');
  if (arrow) arrow.visible = false;
  if (body) {
    body.scale.set(1, 1, 1);
    body.position.y = 0;
    body.rotation.set(0, 0, 0);
  }
  for (const spring of [rig.squash, rig.hop, rig.pitch, rig.roll, rig.lookX, rig.lookY, ...rig.parts]) spring.reset();
}

function tip(part: Object3D | null, axis: Vector3, angle: number) {
  if (part && angle) part.quaternion.multiply(tmpQ.setFromAxisAngle(axis, angle));
}

type Frame = {
  now: number;
  dt: number;
  beat: BeatInfo;
  progress: number;
  live: number;
  wanted: number;
  energy: number;
  motion: number;
};

type Cues = { squash: number; hop: number; pitch: number; roll: number };

type Rig = {
  squash: Spring; hop: Spring; pitch: Spring; roll: Spring;
  lookX: Spring; lookY: Spring;
  parts: Spring[];
  spins: number[];
};

function createRig(kind: MachineKind): Rig {
  const parts: Record<MachineKind, () => Spring[]> = {
    echo: () => Array.from({ length: ECHO_RINGS }, () => new Spring(320, 13)),
    crusher: () => [new Spring(900, 30), new Spring(220, 9)],
    filter: () => [new Spring(380, 11), new Spring(140, 11)],
    space: () => [new Spring(170, 9), new Spring(150, 8), new Spring(130, 8)],
    wide: () => [new Spring(300, 15), new Spring(150, 5)],
    swirl: () => [new Spring(120, 10)],
    warp: () => [new Spring(320, 10), new Spring(320, 10), new Spring(320, 10)],
    washer: () => [new Spring(260, 11), new Spring(320, 16), new Spring(200, 7)],
  };
  return {
    squash: new Spring(280, 15), hop: new Spring(240, 14), pitch: new Spring(160, 12), roll: new Spring(200, 10),
    lookX: new Spring(60, 14), lookY: new Spring(60, 14),
    parts: parts[kind](), spins: [0, 0, 0],
  };
}

export function MachineStation({ definition, station: room, accent }: { definition: StationDefinition; station: StationState; accent: string }) {
  const state = useGameStateWhen((now) => [now.themeId, now.phase]);
  const runtime = useGameRuntime();
  const kind = definition.kind as MachineKind;
  const fx = FX[kind];
  const look = theme(state.themeId).look;
  const model = useMachineModel(kind, look, accent);
  const lobby = state.phase === 'lobby';
  const demoBusy = useLobbyStage((stage) => (stage.busy?.stationId === definition.id ? stage.busy : null));
  const demoRecord = useLobbyStage((stage) => (stage.record?.status === 'station' && stage.record.stationId === definition.id ? stage.record : null));
  const station = useMemo(
    () => (lobby && demoBusy && demoRecord
      ? { ...room, busySince: demoBusy.since, busyUntil: demoBusy.until, blockId: demoRecord.id }
      : room),
    [lobby, demoBusy, demoRecord, room],
  );
  const roomBlock = useStationBlock(room);
  const block = lobby && demoRecord ? demoRecord : roomBlock;
  const rig = useMemo(() => createRig(kind), [kind]);

  const live = useRef(0);
  const wanted = useRef(0);
  const rested = useRef(false);

  const body = useRef<Group>(null);
  const record = useRef<Group>(null);
  const ghosts = useRef<Array<Group | null>>([]);
  const ghostFade = useMemo(() => [{ current: 0 }, { current: 0 }, { current: 0 }], []);
  const light = useRef<PointLight>(null);
  const flash = useRef<Mesh>(null);
  const sift = useRef<Group>(null);
  const particles = useRef<Group>(null);
  const at = useMemo(() => stationPosition(definition), [definition]);
  const rotation = useMemo(() => stationRotation(definition), [definition]);
  const release = useMemo(() => {
    const end = stationExit(definition);
    const dx = end.x - at.x, dz = end.z - at.z;
    return new Vector3(dx * Math.cos(rotation) - dz * Math.sin(rotation), end.y, dx * Math.sin(rotation) + dz * Math.cos(rotation));
  }, [definition, at, rotation]);
  const watching = useMemo(() => new Vector3(), []);

  useFrame((_, delta) => {
    const state = runtime.getState();
    const now = runtime.now();
    const wants = stationAvailability(state, runtime.playerId, definition.id, now).ok;
    const onDeck = fx ? effectOnDeck(state, fx) : false;
    const dt = Math.min(delta, 0.05);
    const progress = jobProgress(station, now);
    live.current += ((onDeck ? 1 : 0) - live.current) * Math.min(1, dt * 3);
    const busy = !!station.blockId && station.busyUntil > now;
    wanted.current += ((wants && !busy ? 1 : 0) - wanted.current) * Math.min(1, dt * 8);
    const beat = beatInfo(state, now);
    const motion = decorativeMotion();
    const frame: Frame = { now, dt, beat, progress, live: live.current, wanted: wanted.current, energy: showEnergy(state, now), motion };

    const { materials } = model;
    materials.Glow.emissiveIntensity = 0.9 + frame.wanted * (0.6 + beat.pulse * 0.8) + (busy ? 1.4 : 0) + beat.pulse * 0.3 * frame.live;
    materials.Pulse.emissiveIntensity = 0.35 + beat.pulse * (0.3 + frame.live * 1.1);

    const idle = PERFORMANCE.stillScenery && !busy && !block && frame.wanted < 0.01;
    if (idle) {
      if (!rested.current) {
        rested.current = true;
        restMachine(model, body.current, rig);
      }
      return;
    }
    rested.current = false;

    const rotor = model.parts.get('Rotor');
    if (rotor) rotor.rotation.z += dt * (busy ? 8 : .45 + frame.live) * motion;
    const arrow = pose(model, 'Arrow');
    if (arrow) {
      const shown = frame.wanted;
      arrow.visible = wants && !busy && shown > 0.02;
      arrow.scale.multiplyScalar(Math.max(0.001, easeOutBack(shown)));
      arrow.position.y += (Math.sin(now / 420) * 0.045 + punch(beat.beatPhase, 3) * 0.06) * shown * motion;
    }

    const cues = bodyLanguage(frame, kind);
    if (kind === 'echo') playEcho(model, frame, rig, cues, record.current, ghosts.current, ghostFade, light.current, !!block);
    else if (kind === 'crusher') playCrusher(model, frame, rig, cues, record.current, flash.current);
    else if (kind === 'filter') playFilter(model, frame, rig, cues, record.current);
    else if (kind === 'space') playSpace(model, frame, rig, record.current);
    else if (kind === 'wide') playWide(model, frame, rig, cues, record.current);
    else if (kind === 'swirl') playSwirl(model, frame, rig, cues, record.current);
    else if (kind === 'warp') playWarp(model, frame, rig, record.current, ghosts.current, ghostFade);
    else playWasher(model, frame, rig, cues, record.current);
    if (isGenericMachine(kind)) playParticles(kind, frame, particles.current);
    moveBody(body.current, rig, cues, dt, kind === 'echo' ? 0.25 : 1);

    if (sift.current) {
      const strength = busy ? Math.sin(smooth(progress, .18, .82) * Math.PI) : 0;
      sift.current.visible = strength > .02;
      sift.current.children.forEach((spark, i) => {
        const angle = now / 230 * motion + i * Math.PI / 3;
        const radius = .68 * (1 - (i % 3) * .14);
        spark.position.set(Math.cos(angle) * radius, 2.92 + Math.sin(angle * 2) * .07 * motion, Math.sin(angle) * radius);
        spark.scale.setScalar(strength * (i % 2 ? .75 : 1) * motion);
      });
    }
    if (record.current && busy && kind !== 'echo' && body.current) {
      const exit = smooth(progress, STATION_HANDOFF_AT, 1);
      if (exit > 0) {
        inverseBody.copy(body.current.matrix).invert();
        record.current.position.lerp(tmpV.copy(release).applyMatrix4(inverseBody), exit);
      }
    }

    const player = livePlayer.known ? livePlayer.position : null;
    if (player) {
      const dx = player.x - at.x, dz = player.z - at.z;
      watching.set(dx * Math.cos(rotation) - dz * Math.sin(rotation), 0, dx * Math.sin(rotation) + dz * Math.cos(rotation));
    }
    const near = player && watching.z > 0 && watching.length() < 14;
    const lookX = rig.lookX.step(near ? clamp(watching.x / Math.max(1, watching.z), -1, 1) : Math.sin(now / 2100) * 0.4, dt);
    const lookY = rig.lookY.step(near ? clamp(1.2 / Math.max(1, watching.length()) - 0.3, -1, 1) : 0, dt);
    for (const name of ['EyeL', 'EyeR']) {
      const eye = pose(model, name);
      if (!eye) continue;
      const strain = busy ? bump(progress, .4, .5, .8) * .75 : 0;
      eye.scale.multiplyScalar(1 + frame.wanted * 0.2 + punch(beat.beatPhase, 5) * 0.08 * frame.live * motion);
      eye.scale.y *= (1 - strain) * (busy ? 1 : eyeOpenness(now, kind.length * 911));
      eye.position.x += lookX * 0.05 * motion;
      eye.position.y += lookY * 0.035 * motion;
    }
  });

  const vinyl = block && (
    <RecordPlace id={block.id}>
      <Vinyl role={block.role} sampleName={block.sampleName} family={gameSample(block.sampleName)?.family} fx={block.fx} glow={0.6} />
    </RecordPlace>
  );

  return (
    <group>
      <group ref={body}>
        <primitive object={model.root} scale={SCALE[kind]} />
        {kind === 'echo' && (
          <>
            <group ref={record} position={[TUNNEL_HALF, ECHO_RECORD_Y, 0]}>
              {vinyl}
              <pointLight ref={light} color={block ? LAYER_COLORS[block.role] : '#ffffff'} intensity={0} distance={4} decay={2} />
            </group>
            {block && ghostFade.map((fade, i) => (
              <group key={i} ref={(node) => { ghosts.current[i] = node; }} position={[TUNNEL_HALF, ECHO_RECORD_Y, 0]} visible={false}>
                <Vinyl role={block.role} sampleName={block.sampleName} fx={block.fx} size={0.94 - i * 0.07} fade={fade} castShadow={false} />
              </group>
            ))}
          </>
        )}
        {kind === 'crusher' && block && <group ref={record} position={[0, CRUSHER_RECORD_Y, 0]}>{vinyl}</group>}
        {kind === 'filter' && block && <group ref={record} position={[0, FILTER_RECORD_Y, 0]}>{vinyl}</group>}
        {isGenericMachine(kind) && <>
          {block && <group ref={record} name={`${MODEL[kind]}_ProcessingRecord`}>{vinyl}</group>}
          {kind === 'warp' && block && ghostFade.map((fade, i) => (
            <group key={i} ref={node => { ghosts.current[i] = node; }} visible={false}>
              <Vinyl role={block.role} sampleName={block.sampleName} fx={block.fx} fade={fade} castShadow={false} />
            </group>
          ))}
        </>}
      </group>
      {kind === 'crusher' && (
        <mesh ref={flash} position={[0, CRUSHER_RECORD_Y, 0]} visible={false}>
          <sphereGeometry args={[0.55, 12, 10]} />
          <meshStandardMaterial
            color="#fff0c4"
            emissive="#ffd88a"
            emissiveIntensity={3}
            transparent
            opacity={0}
            depthWrite={false}
            blending={AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      )}
      {kind === 'filter' && <group ref={sift} visible={false}>
        {Array.from({ length: 6 }, (_, i) => <mesh key={i} material={model.materials.Pulse}>
          <octahedronGeometry args={[.055]} />
        </mesh>)}
      </group>}
      {isGenericMachine(kind) && <group ref={particles} visible={false}>
        {Array.from({ length: PERFORMANCE.tier === 'low' ? 7 : 14 }, (_, i) => (
          <mesh key={i} material={i % 3 ? model.materials.Accent : model.materials.Pulse}>
            {kind === 'washer' ? <sphereGeometry args={[.085, 8, 6]} /> : <octahedronGeometry args={[.06]} />}
          </mesh>
        ))}
      </group>}
    </group>
  );
}

function bodyLanguage(frame: Frame, kind: MachineKind): Cues {
  const { progress: p, beat, live, wanted, energy, motion, now } = frame;
  const busy = p > 0;
  const hit = punch(beat.beatPhase, 4);
  const bob = busy ? 0 : (0.012 + energy * 0.02 + live * 0.055 + wanted * 0.03) * hit;
  const breathe = Math.sin(now / 1300 + kind.length) * 0.008;
  const gulp = busy ? bump(p, .08, .16, .3) : 0;
  const crouch = busy ? bump(p, .72, .8, .85) : 0;
  const spit = busy ? bump(p, .83, .86, .96) : 0;
  return {
    squash: (breathe - bob - gulp * 0.12 - crouch * 0.09 + spit * 0.12) * motion,
    hop: (gulp * 0.05 + spit * 0.06 + wanted * 0.02 * windUp(beat.beatPhase, 0.4) * (busy ? 0 : 1)) * motion,
    pitch: (wanted * 0.05 + gulp * 0.05 - spit * 0.07) * motion,
    roll: 0,
  };
}

function moveBody(body: Group | null, rig: Rig, cues: Cues, dt: number, tilt: number) {
  if (!body) return;
  const squash = rig.squash.step(cues.squash, dt);
  const along = 1 + squash;
  const across = 1 / Math.sqrt(Math.max(0.5, along));
  body.scale.set(across, along, across);
  body.position.y = Math.max(0, rig.hop.step(cues.hop, dt));
  body.rotation.set(rig.pitch.step(cues.pitch, dt) * tilt, 0, rig.roll.step(cues.roll, dt) * tilt);
}

const ECHO_RINGS = 5;
const ECHO_DELAY = 0.75;

function playEcho(
  model: Model,
  frame: Frame,
  rig: Rig,
  cues: Cues,
  record: Group | null,
  ghosts: Array<Group | null>,
  fades: Array<{ current: number }>,
  light: PointLight | null,
  hasBlock: boolean,
) {
  const { progress, beat, live, wanted, dt, motion } = frame;
  const busy = progress > 0;
  const travel = smooth(progress, .12, .94);
  const along = (p: number) => TUNNEL_HALF - clamp(p, 0, 1) * TUNNEL_HALF * 2;
  const lift = (p: number) => ECHO_RECORD_Y + Math.sin(clamp(p, 0, 1) * Math.PI) * 0.16;
  if (record) {
    const entry = 1 - smooth(progress, 0, .12);
    record.position.set(along(travel) + entry * .7, lift(travel) + bump(progress, 0, .06, .12) * .12, 0);
    record.rotation.y += dt * (3 + travel * 6) * motion;
  }
  if (light) light.intensity = busy && hasBlock ? 3 : 0;
  ghosts.forEach((ghost, i) => {
    if (!ghost) return;
    const behind = travel - (i + 1) * 0.12;
    ghost.visible = busy && behind > 0;
    ghost.position.set(along(behind), lift(behind), 0);
    ghost.rotation.y = (record?.rotation.y ?? 0) - (i + 1) * 0.5;
    fades[i]!.current = 0.5 * 0.55 ** i * Math.min(1, behind * 8);
  });

  for (let i = 0; i < ECHO_RINGS; i += 1) {
    const under = 0.1 + (i / (ECHO_RINGS - 1)) * 0.8;
    const passing = busy ? Math.exp(-((travel - under) ** 2) / 0.006) : 0;
    const repeat = punch(beat.beatPhase - i * 0.14, 6) * 0.72 ** i;
    const eager = wanted * punch(beat.beatPhase, 4) * 0.25;
    const jump = rig.parts[i]!.step(passing + (live * 0.8 + 0.08) * repeat + eager, dt);
    const arch = pose(model, `Ring${i + 1}`);
    if (arch) {
      arch.position.y += jump * 0.17 * motion;
      arch.scale.set(1 + jump * 0.1 * motion, 1 + jump * 0.14 * motion, 1 + jump * 0.1 * motion);
    }
    const material = model.own.get(`Ring${i + 1}`);
    if (material) material.emissiveIntensity = 0.35 + passing * 3 + repeat * 1.8 * live + Math.max(0, jump) * 0.8;
  }

  for (let i = 0; i < 3; i += 1) {
    const wave = pose(model, `Wave${i + 1}`);
    const material = model.own.get(`Wave${i + 1}`);
    if (!wave || !material) continue;
    let t: number;
    let strength: number;
    if (busy) {
      t = (progress * 3 + i / 3) % 1;
      strength = 0.8;
    } else {
      t = beat.beatPhase - i * ECHO_DELAY * 0.33;
      strength = live * 0.7 ** i;
      if (t < 0) t += 1;
    }
    wave.scale.multiplyScalar(1 + t * 0.65 * motion);
    wave.position.x -= t * 0.9 * motion;
    material.opacity = (1 - t) ** 1.5 * strength;
  }

  if (busy) cues.squash -= (bump(progress, .78, .8, .84) * 0.07 + bump(progress, .85, .87, .9) * 0.045 + bump(progress, .91, .93, .96) * 0.025) * motion;
}

function playCrusher(model: Model, frame: Frame, rig: Rig, cues: Cues, record: Group | null, flash: Mesh | null) {
  const { progress: p, beat, live, wanted, now, dt, motion } = frame;
  const busy = p > 0;
  const [ram, needle] = rig.parts as [Spring, Spring];
  let target: number;
  if (busy) {
    if (p < .16) target = .32;
    else if (p < .42) target = .32 + smooth(p, .16, .42) * .2 + Math.sin(now / 22) * .02 * smooth(p, .28, .42);
    else if (p < .6) target = -CRUSHER_STROKE;
    else if (p < .65) target = .22;
    else if (p < .7) target = -CRUSHER_STROKE;
    else if (p < .75) target = .12;
    else if (p < .8) target = -CRUSHER_STROKE;
    else target = 0;
  } else {
    const hungry = wanted * (.24 - punch(beat.beatPhase, 7) * .2);
    const stamp = live * (windUp(beat.beatPhase, .3) * .12 - punch(beat.beatPhase, 3) * .2);
    target = hungry + stamp + Math.sin(now / 1200) * .018;
  }
  const drop = ram.step(target, dt);
  const ramPart = pose(model, 'Ram');
  if (ramPart) {
    ramPart.position.y += drop * motion;
    if (busy && p > .45 && p < .6) ramPart.position.x += Math.sin(now / 17) * 0.012 * motion;
    tip(ramPart, Z, (busy ? Math.sin(p * 40) * .03 * bump(p, .6, .7, .82) : Math.sin(now / 1700) * .015) * motion);
  }
  const contact = clamp((-drop - CRUSHER_STROKE * 0.8) / (CRUSHER_STROKE * 0.2), 0, 1);
  if (record) {
    const slide = 1 - smooth(p, 0, .2);
    record.position.set(0, CRUSHER_RECORD_Y, slide * .6);
    record.rotation.y = slide * 2.4 * motion;
    const flat = busy ? Math.max(contact, smooth(p, .45, .8) * .45) : 0;
    record.scale.set(1 + flat * 0.3, Math.max(0.35, 1 - flat * 0.6), 1 + flat * 0.3);
  }
  if (flash) {
    const hit = busy ? contact * bump(p, .42, .46, .56) * motion : 0;
    flash.scale.setScalar(0.5 + hit * 0.9);
    (flash.material as MeshStandardMaterial).opacity = hit * 0.55;
    flash.visible = hit > 0.01;
  }
  cues.squash -= contact * (busy ? 0.1 : 0.03) * motion;
  cues.roll += (busy ? Math.sin(now / 45) * 0.012 * contact : 0) * motion;
  const pressure = needle.step(busy ? Math.max(contact, smooth(p, .16, .42) * .45) : punch(beat.beatPhase, 4) * .3 * live, dt);
  pose(model, 'Needle', Z, 1.05 - pressure * 2.1 + Math.sin(now / 70) * 0.02 * motion);
  const beacon = pose(model, 'Beacon', Y, (busy ? p * Math.PI * 6 : Math.sin(now / 2200) * .2) * motion);
  if (beacon) beacon.scale.multiplyScalar(1 + (busy ? 0.08 + contact * 0.2 : 0) + beat.pulse * 0.08 * live);
}

function playFilter(model: Model, frame: Frame, rig: Rig, cues: Cues, record: Group | null) {
  const { progress: p, beat, live, wanted, now, dt, motion } = frame;
  const busy = p > 0;
  const [flex, knob] = rig.parts as [Spring, Spring];
  const dip = smooth(p, .12, .38) * (1 - smooth(p, .66, .8));
  const swallow = busy ? bump(p, .36, .4, .46) + bump(p, .48, .52, .58) + bump(p, .6, .64, .7) : 0;
  const splash = busy ? bump(p, .14, .18, .28) : 0;
  const launch = busy ? bump(p, .74, .8, .86) : 0;
  const cone = flex.step(busy ? splash * 1.2 + swallow * .8 - launch * 1.4 : punch(beat.beatPhase, 4) * (.25 + live * .9) + wanted * punch(beat.beatPhase, 3) * .3, dt);
  if (record) {
    const up = smooth(p, .74, .84) * .5;
    record.position.set(0, FILTER_RECORD_Y - dip * FILTER_DIP + up - Math.max(0, cone) * .05, 0);
    record.rotation.y += dt * (busy ? 3 + dip * 9 : .5) * motion;
  }
  const close = busy ? smooth(p, 0.05, 0.6) * (1 - smooth(p, 0.8, 1) * 0.35) : 0;
  const lfo = (Math.sin((beat.beatPhase + beat.barPhase * 4) * Math.PI * 0.5) * 0.5 + 0.5) * live * 0.3 * motion;
  const cutoff = 1 - close * 0.62 - lfo;
  const curve = pose(model, 'Curve');
  if (curve) {
    curve.scale.x = Math.max(0.2, cutoff);
    curve.scale.y *= 1 + punch(beat.beatPhase, 5) * .25 * live * motion;
  }
  pose(model, 'Knob', Z, knob.step((1 - cutoff) * 2.4 - 0.4, dt) + Math.sin(now / 1300) * 0.03 * motion);
  const conePart = pose(model, 'Cone', Y, Math.sin(now / 2400) * 0.025 * motion);
  if (conePart) {
    conePart.scale.x *= 1 + cone * 0.05 * motion;
    conePart.scale.y *= 1 - cone * 0.09 * motion;
    conePart.scale.z *= 1 + cone * 0.05 * motion;
    tip(conePart, X, wanted * .1 * motion);
  }
  cues.squash -= splash * .04 * motion;
}

function playSpace(model: Model, frame: Frame, rig: Rig, record: Group | null) {
  const { progress: p, beat, live, wanted, now, dt, motion } = frame;
  const busy = p > 0;
  const t = now / 1000;
  const accept = smooth(p, 0, .18);
  const work = smooth(p, .18, .32) * (1 - smooth(p, .7, .82));
  const cycle = smooth(p, .18, .78);
  if (record) {
    record.scale.set(1, 1, 1);
    record.position.set(0, 1.0 + accept * .48 + Math.sin(t * 3.2) * .05 * work * motion, 1.35 * (1 - accept));
    record.rotation.set(Math.sin(t * 2.1) * .25 * work * motion, cycle * Math.PI * 3 * motion, Math.cos(t * 1.7) * .2 * work * motion);
  }
  for (let i = 1; i <= 3; i++) {
    const open = busy ? .3 * accept * (1 - smooth(p, .2, .3)) + .12 * work - .16 * bump(p, .78, .82, .88) : 0;
    const throb = punch(beat.beatPhase - (i - 1) * 0.08, 4) * (live * .14 + .02) + wanted * .05 * punch(beat.beatPhase, 3);
    const spread = rig.parts[i - 1]!.step(open + throb, dt);
    const speed = (i % 2 ? 1 : -1) * (.13 + i * .03 + live * .25 + work * (3 + i * 1.6));
    rig.spins[i - 1]! += dt * speed * motion;
    const ring = pose(model, `Ring${i}`, Y, rig.spins[i - 1]! + i);
    if (ring) {
      tip(ring, i === 2 ? Z : X, Math.sin(rig.spins[i - 1]! * .7 + i) * (.1 + work * .25) * motion);
      ring.scale.multiplyScalar(1 + spread * motion);
      ring.position.y += Math.sin(t * 1.3 + i) * .025 * motion + work * (i - 2) * .18;
    }
    const glow = model.own.get(`Ring${i}`);
    if (glow) glow.emissiveIntensity = .5 + work * (1.2 + Math.sin(cycle * 12 - i) * .6) + Math.max(0, spread) * 3;
    const wave = pose(model, `Wave${i}`), mat = model.own.get(`Wave${i}`);
    if (wave && mat) {
      const phase = busy ? (cycle * 2.5 + i / 3) % 1 : (beat.beatPhase + i / 3) % 1;
      wave.scale.multiplyScalar(1 + phase * .9 * motion);
      wave.position.y += (i - 2) * phase * .55 * motion;
      mat.opacity = (busy ? work * .5 : live * .3) * (1 - phase);
    }
  }
}

function playWide(model: Model, frame: Frame, rig: Rig, cues: Cues, record: Group | null) {
  const { progress: p, beat, live, wanted, now, dt, motion } = frame;
  const busy = p > 0;
  const [jaws, jelly] = rig.parts as [Spring, Spring];
  let open: number;
  if (busy) {
    if (p < .16) open = .42;
    else if (p < .26) open = -.06;
    else if (p < .7) open = -.06 + smooth(p, .26, .66) * .52;
    else open = 0;
  } else {
    open = live * .14 * punch(beat.beatPhase, 3) + wanted * (.1 + Math.sin(now / 260) * .04) + Math.sin(now / 1500) * .012;
  }
  const gap = jaws.step(open, dt);
  for (const [name, side] of [['Left', -1], ['Right', 1]] as const) {
    const jaw = pose(model, name);
    if (jaw) {
      jaw.position.x += side * gap * motion;
      tip(jaw, Z, -side * gap * .12 * motion);
    }
  }
  const bellows = pose(model, 'Bellows');
  if (bellows) {
    bellows.scale.x *= 1 + Math.max(0, gap) * 1.1 * motion;
    bellows.scale.y *= 1 - Math.max(0, gap) * .12 * motion;
  }
  const stretch = jelly.step(busy && p > .26 && p < .7 ? smooth(p, .26, .66) * .6 : 0, dt);
  const bite = busy ? bump(p, .16, .2, .3) : 0;
  if (record) {
    record.rotation.set(0, 0, 0);
    record.position.set(0, 1.36, 1.35 * (1 - smooth(p, 0, .16)));
    record.scale.set(1 + stretch * motion, 1 - bite * .12, Math.max(.55, 1 - stretch * .3 - bite * .1));
  }
  cues.squash -= bite * .06 * motion;
  cues.hop += bump(p, .7, .72, .8) * .05 * motion;
}

function playSwirl(model: Model, frame: Frame, rig: Rig, cues: Cues, record: Group | null) {
  const { progress: p, beat, live, wanted, now, dt, motion } = frame;
  const busy = p > 0;
  const accept = smooth(p, 0, .18);
  const release = smooth(p, .78, .94);
  const work = smooth(p, .18, .32) * (1 - smooth(p, .7, .84));
  const speed = busy
    ? 1 + 26 * Math.sin(Math.PI * smooth(p, .12, .82)) ** 2
    : .35 + live * (1.1 + punch(beat.beatPhase, 3) * 7) + wanted * 1.5;
  rig.spins[0]! += dt * speed * motion;
  const spin = rig.spins[0]!;
  pose(model, 'Turbine', Z, spin);
  if (record) {
    const radius = .5 * (1 - smooth(p, .15, .5)) + .04 * work;
    const orbit = spin * .45;
    record.scale.set(1, 1, 1);
    record.position.set(Math.cos(orbit) * radius * motion, 1.72 + Math.sin(orbit) * radius * motion, .47 + (1 - accept) * .88);
    record.rotation.set(Math.PI / 2 * accept * (1 - release), 0, spin * (1 - release) * motion);
  }
  for (let i = 1; i <= 3; i++) {
    const wave = pose(model, `Wave${i}`, Z, spin * (.4 + i * .15) + i * 2);
    const mat = model.own.get(`Wave${i}`);
    if (wave && mat) {
      wave.scale.multiplyScalar(.7 + i * .12 + work * .15 * Math.sin(now / 90 + i) + punch(beat.beatPhase, 4) * .12 * live);
      wave.position.z += .04 * i;
      mat.opacity = work * .55 + live * .25 * punch(beat.beatPhase, 3);
    }
  }
  const blur = busy ? Math.sin(Math.PI * smooth(p, .12, .82)) ** 4 : 0;
  cues.roll += Math.sin(now / 21) * .014 * blur * motion;
  cues.hop += Math.abs(Math.sin(now / 37)) * .015 * blur * motion;
  cues.squash += rig.parts[0]!.step(blur * .03, dt) * motion;
}

const PORTALS = [new Vector3(-.52, 1.54, .55), new Vector3(0, 1.82, .1), new Vector3(.52, 2.1, -.35)];
const WARP_HOPS = [[.12, .3], [.42, .6]] as const;
const WARP_ENTRY = new Vector3(-.52, 1.48, 1.35);
const WARP_OUT = new Vector3(.52, 1.9, 1.2);
const warpAt = new Vector3();

function warpPath(p: number, out: Vector3): number {
  if (p < WARP_HOPS[0][0]) {
    out.copy(WARP_ENTRY).lerp(PORTALS[0]!, smooth(p, 0, WARP_HOPS[0][0]));
    return 1;
  }
  for (let i = 0; i < WARP_HOPS.length; i += 1) {
    const [into, emerge] = WARP_HOPS[i]!;
    if (p < into) return 1;
    if (p < emerge) {
      const k = (p - into) / (emerge - into);
      out.copy(PORTALS[i]!).lerp(PORTALS[i + 1]!, smooth(k, .2, .8));
      return k < .5 ? 1 - smooth(k, 0, .25) * .9 : .1 + smooth(k, .75, 1) * .9;
    }
    out.copy(PORTALS[i + 1]!);
  }
  out.lerp(WARP_OUT, smooth(p, .6, .82));
  return 1;
}

function playWarp(model: Model, frame: Frame, rig: Rig, record: Group | null, ghosts: Array<Group | null>, fades: Array<{ current: number }>) {
  const { progress: p, beat, live, wanted, now, dt, motion } = frame;
  const busy = p > 0;
  const t = now / 1000;
  const work = smooth(p, .08, .2) * (1 - smooth(p, .7, .84));
  let size = 1;
  if (record) {
    size = warpPath(p, warpAt);
    record.position.copy(warpAt);
    record.rotation.set(Math.PI / 2 * smooth(p, 0, .1) * (1 - smooth(p, .74, .84)), 0, t * 5 * work * motion);
    record.scale.setScalar(size);
  }
  for (let i = 1; i <= 3; i++) {
    const through = busy ? WARP_HOPS.reduce((sum, [into, emerge], hop) =>
      sum + (hop === i - 1 ? bump(p, into - .02, into + .02, into + .08) : 0) + (hop === i - 2 ? bump(p, emerge - .04, emerge, emerge + .08) : 0), 0) : 0;
    const beatHop = punch(beat.beatPhase - (i - 1) * .12, 5) * (live * .8 + .1) + wanted * punch(beat.beatPhase, 3) * .3;
    const kick = rig.parts[i - 1]!.step(through * 1.3 + beatHop, dt);
    const portal = pose(model, `Portal${i}`, Z, (Math.sin(t * .8 + i) * .03 + Math.sin(p * 20 - i) * work * .1 + kick * .12) * motion);
    if (portal) {
      portal.position.y += (Math.sin(t * 1.1 + i * 1.3) * .03 + kick * .1) * motion;
      portal.scale.multiplyScalar(1 + kick * .16 * motion);
    }
  }
  ghosts.forEach((ghost, i) => {
    if (!ghost || !record) return;
    const lag = p - (i + 1) * .035;
    const ghostSize = warpPath(lag, warpAt);
    ghost.visible = busy && work > .02 && lag > .1;
    ghost.position.copy(warpAt);
    ghost.rotation.copy(record.rotation);
    ghost.scale.setScalar(ghostSize * (1 - i * .1));
    fades[i]!.current = work * (.34 - i * .09);
  });
}

function playWasher(model: Model, frame: Frame, rig: Rig, cues: Cues, record: Group | null) {
  const { progress: p, beat, live, wanted, now, dt, motion, energy } = frame;
  const busy = p > 0;
  const t = now / 1000;
  const [door, dial, rock] = rig.parts as [Spring, Spring, Spring];
  const opening = busy ? (p < .16 ? 1.3 : p < .82 ? 0 : 1.3) : wanted * (.32 + Math.sin(t * 5) * .06);
  const swing = door.step(opening, dt);
  const wash = busy ? smooth(p, .2, .26) * (1 - smooth(p, .5, .56)) : 0;
  const spinning = busy ? smooth(p, .52, .62) * (1 - smooth(p, .74, .8)) : 0;
  const slosh = Math.sin((p - .2) * Math.PI * 2 / .1) * 2.2 * wash;
  rig.spins[0]! += dt * (spinning * 34 + (busy ? 0 : .25 + energy * .3)) * motion;
  const drumAngle = rig.spins[0]! + slosh * motion;
  pose(model, 'Drum', Z, drumAngle);
  const doorPart = pose(model, 'Door', Y, -swing * motion);
  const shake = Math.sin(t * 55) * .03 * spinning;
  const rocked = rock.step(busy ? shake + bump(p, .16, .18, .26) * .06 : punch(beat.beatPhase, 4) * .015 * (1 + energy), dt);
  const cabinet = pose(model, 'Cabinet');
  if (cabinet) cabinet.rotation.z += rocked * motion;
  if (doorPart) doorPart.position.x += rocked * .3 * motion;
  const stage = busy ? Math.min(3, Math.floor(p / .25)) : 0;
  pose(model, 'Dial', Z, dial.step(busy ? .4 + stage * 1.15 : -.35, dt));
  pose(model, 'Sock', Z, (Math.sin(t * 2) * .025 + Math.sin(t * 19) * .4 * spinning + Math.sin(t * 7) * .12 * wash + live * .05 * punch(beat.beatPhase, 3)) * motion);
  if (record) {
    const into = smooth(p, .04, .16);
    const out = smooth(p, .82, .9);
    const inDrum = into * (1 - out);
    record.position.set(Math.sin(drumAngle) * .13 * inDrum, 1.28 + Math.cos(drumAngle) * .12 * inDrum, 1.35 - into * .7 + out * .45);
    record.rotation.set(Math.PI / 2 * into * (1 - out), 0, drumAngle * inDrum);
    record.scale.setScalar(1);
  }
  cues.squash -= bump(p, .16, .18, .24) * .07 * motion;
  cues.hop += (Math.abs(Math.sin(t * 27)) * .03 * spinning + bump(p, .16, .19, .26) * .03) * motion;
  cues.roll += Math.sin(t * 31) * .012 * spinning * motion;
}

function playParticles(kind: GenericMachineKind, frame: Frame, particles: Group | null) {
  if (!particles) return;
  const { progress: p, motion } = frame;
  const busy = p > 0;
  const work = smooth(p, .18, .32) * (1 - smooth(p, .7, .84));
  const cycle = smooth(p, .18, .78);
  const rinse = kind === 'washer' ? Math.sin(smooth(p, .76, .95) * Math.PI) : 0;
  particles.visible = busy && Math.max(work, rinse) > .01;
  if (!particles.visible) return;
  particles.children.forEach((spark, i) => {
    const phase = (cycle * 2 + i / particles.children.length) % 1;
    const angle = i * 2.4 + cycle * 6 * motion;
    if (kind === 'washer') {
      spark.position.set(Math.sin(i * 4.2 + cycle * 3 * motion) * .57, .83 + phase * .85, 1.04 + rinse * .2);
    } else {
      spark.position.set(Math.cos(angle) * (.8 + phase * .35), 1.48 + Math.sin(angle * .7) * .4, Math.sin(angle) * .6);
    }
    spark.scale.setScalar((.5 + (i % 4) * .28) * Math.max(work, rinse * .65));
  });
}

useGLTF.preload(MACHINES_FILE, DRACO_DECODER);
