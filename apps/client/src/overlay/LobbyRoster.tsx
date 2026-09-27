import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import {
  AgXToneMapping,
  AnimationMixer,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderTarget,
  type AnimationAction,
  type AnimationClip,
  type Group,
  type Texture,
} from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PlayerState } from '@loop/shared';
import { useGameRuntime, useGameState } from '../runtime/GameRuntimeContext';
import { holdReveal, lobbySeats, useStageReady } from '../game/stage';
import { useBackstage } from '../game/backstage';
import { applyToonStyle } from '../game/toon';
import { DRACO_DECODER, MOVES_FILE, idleSecondsAt, lobbyIdleFor, rigForPlayer } from '../game/scene/PerformerRig';

export function LobbyRoster({ asleep = false }: { asleep?: boolean }) {
  const state = useGameState();
  const runtime = useGameRuntime();
  const settled = useStageReady((store) => store.settled);
  const backstage = useBackstage((store) => store.backstage);
  const root = useRef<HTMLDivElement>(null);
  const [portraits, setPortraits] = useState(false);
  const seats = lobbySeats(state.players, runtime.playerId);
  const faces = useLeaving(seats.map((id) => state.players[id]!).filter(Boolean), runtime);

  useEffect(() => {
    if (settled) setPortraits(true);
  }, [settled]);

  return (
    <div className="lobby-roster" ref={root} aria-label={`${seats.length} in the room`} role="list">
      {faces.map(({ player, leaving }) => (
        <div
          key={player.id}
          role="listitem"
          aria-label={`${player.name}${player.id === state.hostId ? ', hosting' : ''}${player.id === runtime.playerId ? ', you' : ''}`}
          title={player.name}
          data-face={player.id}
          className={`roster-face${leaving ? ' is-leaving' : ''}${player.id === runtime.playerId ? ' is-you' : ''}`}
          style={{ ['--who' as string]: player.color } as CSSProperties}
        >
          {player.id === state.hostId && <i className="roster-host" aria-hidden="true" />}
        </div>
      ))}
      {portraits && (
        <div className="roster-canvas" aria-hidden="true">
          <Canvas
            frameloop={backstage || asleep ? 'never' : 'always'}
            dpr={[1, 2]}
            gl={{ alpha: true, antialias: true, powerPreference: 'low-power', toneMapping: AgXToneMapping }}
            camera={{ position: [0, 0, 1] }}
            style={{ pointerEvents: 'none' }}
            onCreated={({ gl }) => { gl.debug.checkShaderErrors = import.meta.env.DEV; }}
          >
            <Suspense fallback={null}>
              <Portraits faces={faces.map(({ player }) => player)} root={root} asleep={asleep} />
            </Suspense>
          </Canvas>
        </div>
      )}
    </div>
  );
}

const EARS = 0.55;
const WIDE = 2.4;
const CUT = -0.9;
const SHOULDERS = -0.35;
const RING = 0.9;

type Portrait = {
  id: string;
  release: (() => void) | null;
  scene: Scene;
  camera: PerspectiveCamera;
  mixer: AnimationMixer;
  idle: AnimationAction | null;
  target: WebGLRenderTarget;
  quad: Mesh<PlaneGeometry, MeshBasicMaterial>;
};

function Portraits({ faces, root, asleep }: { faces: PlayerState[]; root: RefObject<HTMLDivElement | null>; asleep: boolean }) {
  const sleeping = useRef(asleep);
  sleeping.current = asleep;
  const gl = useThree((three) => three.gl);
  const registry = useRef(new Map<string, Portrait>()).current;
  const board = useMemo(() => ({ scene: new Scene(), camera: new OrthographicCamera(0, 1, 1, 0, -1, 1) }), []);
  const runtime = useGameRuntime();

  useFrame(() => {
    const holder = root.current;
    if (!holder) return;
    const area = gl.domElement.getBoundingClientRect();
    const ratio = gl.getPixelRatio();
    gl.autoClear = false;
    for (const [id, portrait] of registry) {
      if (portrait.idle) portrait.idle.time = idleSecondsAt(id, portrait.idle.getClip().duration, runtime.now());
      portrait.mixer.update(0);
      const face = holder.querySelector<HTMLElement>(`[data-face="${CSS.escape(id)}"]`);
      const rect = face?.getBoundingClientRect();
      portrait.quad.visible = !!face && !!rect && rect.width > 2;
      if (!face || !rect || !portrait.quad.visible) continue;
      const [width, height] = pictureSize(face.offsetWidth, ratio);
      if (portrait.target.width !== width || portrait.target.height !== height) portrait.target.setSize(width, height);
      gl.setRenderTarget(portrait.target);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(portrait.scene, portrait.camera);
      const w = rect.width * WIDE;
      const h = rect.height * (1 + EARS);
      portrait.quad.scale.set(w, h, 1);
      portrait.quad.position.set(rect.left - area.left + rect.width / 2, area.bottom - rect.bottom + h / 2, 0);
    }
    gl.setRenderTarget(null);
    board.camera.right = area.width;
    board.camera.top = area.height;
    board.camera.updateProjectionMatrix();
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(board.scene, board.camera);
    for (const portrait of registry.values()) {
      portrait.release?.();
      portrait.release = null;
    }
  }, 1);

  return (
    <>
      {faces.map((player) => (
        <PortraitHead key={player.id} player={player} registry={registry} board={board.scene} root={root} sleeping={sleeping} />
      ))}
    </>
  );
}

function pictureMaterial(texture: Texture) {
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `void main() {
        vec2 circle = vec2((vMapUv.x - 0.5) * ${(2 * WIDE).toFixed(3)}, vMapUv.y * ${(2 * (1 + EARS)).toFixed(3)} - 1.0);
        if (circle.y < ${CUT.toFixed(3)}) discard;
        if (circle.y < ${SHOULDERS.toFixed(3)} && length(circle) > ${RING.toFixed(3)}) discard;`,
    );
  };
  material.customProgramCacheKey = () => 'roster-picture';
  return material;
}

function PortraitHead({ player, registry, board, root, sleeping }: {
  player: PlayerState;
  registry: Map<string, Portrait>;
  board: Scene;
  root: RefObject<HTMLDivElement | null>;
  sleeping: RefObject<boolean>;
}) {
  const gl = useThree((three) => three.gl);
  const rigFile = rigForPlayer(player.id, player.color);
  const { scene: rig, animations } = useGLTF(rigFile, DRACO_DECODER) as unknown as { scene: Group; animations: AnimationClip[] };
  const { animations: moves } = useGLTF(MOVES_FILE, DRACO_DECODER) as unknown as { animations: AnimationClip[] };

  useEffect(() => {
    const body = applyToonStyle(clone(rig), false);
    body.rotation.y = 0.35;
    const scene = new Scene();
    scene.add(body);
    scene.add(new HemisphereLight(0xffffff, 0x3b3550, 1.9));
    const key = new DirectionalLight(0xffffff, 2.1);
    key.position.set(1.5, 3, 4);
    scene.add(key);

    body.updateMatrixWorld(true);
    const head = body.getObjectByName('Head');
    const centre = new Vector3();
    if (head) head.getWorldPosition(centre);
    else centre.set(0, 3, 0);
    centre.y += HEAD_LIFT;
    const camera = new PerspectiveCamera(fovFor(HEAD_RADIUS, CAMERA_DISTANCE), WIDE / (1 + EARS), 0.1, 50);
    camera.position.set(centre.x, centre.y + HEAD_RADIUS * EARS, centre.z + CAMERA_DISTANCE);
    camera.lookAt(centre.x, centre.y + HEAD_RADIUS * EARS, centre.z);

    const clips = [...animations, ...moves];
    const mixer = new AnimationMixer(body);
    const idleClip = clips.find((clip) => clip.name === lobbyIdleFor(player.id)) ?? clips.find((clip) => clip.name === 'Idle');
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    idle?.setEffectiveTimeScale(0).play();
    const face = root.current?.querySelector<HTMLElement>(`[data-face="${CSS.escape(player.id)}"]`);
    const [width, height] = pictureSize(face?.offsetWidth ?? 0, gl.getPixelRatio());
    const target = new WebGLRenderTarget(width || 4, height || 4, { samples: 4 });
    const quad = new Mesh(new PlaneGeometry(1, 1), pictureMaterial(target.texture));
    let cancelled = false;
    const release = sleeping.current ? () => undefined : holdReveal();
    const picture = new Scene();
    picture.add(quad);
    const previous = gl.getRenderTarget();
    const compiling: Promise<unknown>[] = [];
    try {
      gl.setRenderTarget(target);
      compiling.push(gl.compileAsync(scene, camera));
      gl.setRenderTarget(null);
      compiling.push(gl.compileAsync(picture, camera));
    } catch {} finally {
      gl.setRenderTarget(previous);
    }
    void Promise.all(compiling).catch(() => undefined).then(() => {
      if (cancelled) return;
      const before = gl.getRenderTarget();
      gl.setRenderTarget(target);
      gl.render(scene, camera);
      gl.setRenderTarget(before);
      board.add(quad);
      registry.set(player.id, { id: player.id, release, scene, camera, mixer, idle, target, quad });
    });
    return () => {
      cancelled = true;
      release();
      mixer.stopAllAction();
      registry.delete(player.id);
      board.remove(quad);
      quad.geometry.dispose();
      quad.material.dispose();
      target.dispose();
    };
  }, [animations, board, gl, moves, player.id, registry, rig, root]);

  return null;
}

function pictureSize(size: number, ratio: number): [number, number] {
  return [Math.round(size * WIDE * ratio), Math.round(size * (1 + EARS) * ratio)];
}

const HEAD_RADIUS = 1.0;
const HEAD_LIFT = 0.55;
const CAMERA_DISTANCE = 7;

function fovFor(radius: number, distance: number) {
  const half = (radius * (1 + EARS)) / distance;
  return (2 * Math.atan(half) * 180) / Math.PI;
}

function useLeaving(players: PlayerState[], room: unknown) {
  const [gone, setGone] = useState<PlayerState[]>([]);
  const last = useRef<PlayerState[]>(players);
  const lastRoom = useRef(room);
  const ids = players.map((player) => player.id).join('|');
  useEffect(() => {
    if (lastRoom.current !== room) {
      lastRoom.current = room;
      last.current = players;
      setGone([]);
      return;
    }
    const now = new Set(players.map((player) => player.id));
    const left = last.current.filter((player) => !now.has(player.id));
    last.current = players;
    if (!left.length) return;
    setGone((list) => [...list.filter((player) => !now.has(player.id)), ...left]);
    const timer = window.setTimeout(() => setGone((list) => list.filter((player) => !left.includes(player))), 420);
    return () => window.clearTimeout(timer);
  }, [ids, room]);
  return [
    ...players.map((player) => ({ player, leaving: false })),
    ...gone.filter((player) => !players.some((each) => each.id === player.id)).map((player) => ({ player, leaving: true })),
  ];
}
