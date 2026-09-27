import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import {
  AnimationClip,
  AnimationMixer,
  Group,
  HalfFloatType,
  PerspectiveCamera,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type SkinnedMesh,
  type WebGLRenderer,
} from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { DECK_POSITION, DECK_RING_RADIUS, type GameState } from '@loop/shared';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { DEV_HANDLE } from '../../runtime/devFlag';
import { COVER_SIZE, setCover, useCover } from '../cover';
import type { DevelopAnswer, DevelopJob } from '../coverDevelop.worker';
import { seeEveryLayer } from '../layers';
import { IS_PHONE, PERFORMANCE } from '../performance';
import { FINALE, RIG_FEET } from '../stage';
import { applyToonStyle } from '../toon';
import { dullFloorForCover, poseMeterForCover } from './DiscoFloor';
import { DECK_TOP, RING_INNER } from './deckModel';
import { DRACO_DECODER, MOVES_FILE, RIG_FILES, rigForPlayer } from './PerformerRig';

export function CoverShoot() {
  const runtime = useGameRuntime();
  const gl = useThree((three) => three.gl);
  const scene = useThree((three) => three.scene);
  const rigs = useGLTF(RIG_FILES, DRACO_DECODER) as unknown as Array<{ scene: Group }>;
  const { animations: moves } = useGLTF(MOVES_FILE, DRACO_DECODER) as unknown as { animations: AnimationClip[] };
  const taken = useRef<number | null>(null);
  const darkroom = useRef<Darkroom | null>(null);
  const again = useRef(false);

  useEffect(() => () => {
    darkroom.current?.close();
    darkroom.current = null;
  }, []);

  useEffect(() => {
    if (!DEV_HANDLE) return;
    const handle = ((window as unknown as { __loop?: Record<string, unknown> }).__loop ??= {});
    handle.shootCover = () => { again.current = true; };
    Object.defineProperty(handle, 'cover', { configurable: true, get: () => useCover.getState().url });
  }, []);

  useFrame(() => {
    const state = runtime.getState();
    if (state.phase !== 'complete' || state.completedAt === null) return;
    const due = runtime.now() >= state.completedAt + FINALE.cut + 80;
    if (!due || (taken.current === state.completedAt && !again.current)) return;
    taken.current = state.completedAt;
    again.current = false;
    const show = state.completedAt;
    darkroom.current ??= new Darkroom();
    const room = darkroom.current;
    void photograph(gl, scene, state, rigs, moves)
      .then((job) => room.develop(job))
      .then((blob) => {
        if (runtime.getState().completedAt === show) setCover(show, blob);
      })
      .catch((error) => console.warn('[cover] not taken:', error));
  });

  return null;
}

const WAVE_LEFT = { clip: 'Victory', at: 0.8 };
const WAVE_RIGHT = { clip: 'Celebrate', at: 0.2 };
const MIDDLE = [
  { clip: 'Dance_Jump', at: 0.2 },
  { clip: 'Victory', at: 0.5 },
  { clip: 'Dance_Rave', at: 0.5 },
];
function poseFor(index: number, count: number) {
  if (index === 0) return WAVE_LEFT;
  if (index === count - 1) return WAVE_RIGHT;
  return MIDDLE[(index - 1) % MIDDLE.length]!;
}

const CAMERA = {
  position: new Vector3(DECK_POSITION.x, 10.4, DECK_POSITION.z + 15.2),
  target: new Vector3(DECK_POSITION.x, 2.3, DECK_POSITION.z - 0.9),
  fov: 40,
};
const BAND_RADIUS = (RING_INNER + DECK_RING_RADIUS) / 2;
const BAND_STEP = 0.27;

async function photograph(
  gl: WebGLRenderer,
  scene: Scene,
  state: GameState,
  rigs: Array<{ scene: Group }>,
  moves: AnimationClip[],
): Promise<DevelopJob> {
  const source = COVER_SIZE * 2;
  const target = new WebGLRenderTarget(source, source, { type: HalfFloatType, samples: IS_PHONE ? 0 : 4 });
  const camera = new PerspectiveCamera(CAMERA.fov, 1, 0.5, 160);
  const hold = DEV_HANDLE ? (window as unknown as { __loop?: { coverCamera?: { position: number[]; target: number[]; fov?: number } } }).__loop?.coverCamera : undefined;
  camera.position.copy(hold ? new Vector3().fromArray(hold.position) : CAMERA.position);
  camera.fov = hold?.fov ?? CAMERA.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(hold ? new Vector3().fromArray(hold.target) : CAMERA.target);
  camera.updateMatrixWorld();
  seeEveryLayer(camera);

  const band = new Group();
  const players = Object.values(state.players);
  const mixers: AnimationMixer[] = [];
  players.forEach((player, index) => {
    const rig = rigs[RIG_FILES.indexOf(rigForPlayer(player.id, player.color))];
    if (!rig) return;
    const body = applyToonStyle(clone(rig.scene), PERFORMANCE.shadows);
    const poses = DEV_HANDLE ? (window as unknown as { __loop?: { coverPoses?: Array<{ clip: string; at: number }> } }).__loop?.coverPoses : undefined;
    const pose = poses?.[index % poses.length] ?? poseFor(index, players.length);
    const clip = AnimationClip.findByName(moves, pose.clip);
    if (clip) {
      const mixer = new AnimationMixer(body);
      mixer.clipAction(clip).play();
      mixer.setTime(clip.duration * pose.at);
      mixers.push(mixer);
    }
    const angle = Math.PI - (index - (players.length - 1) / 2) * BAND_STEP;
    const x = DECK_POSITION.x + Math.sin(angle) * BAND_RADIUS;
    const z = DECK_POSITION.z + Math.cos(angle) * BAND_RADIUS;
    body.position.set(x, DECK_TOP + RIG_FEET, z);
    body.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z) - x * 0.06;
    band.add(body);
  });
  scene.add(band);
  band.updateMatrixWorld(true);

  const away: Object3D[] = [];
  scene.traverse((object) => {
    if (object.visible && (object.name.startsWith('performer-') || object.name === 'replay-ledge')) away.push(object);
  });
  for (const object of away) object.visible = false;
  const unposeMeter = poseMeterForCover(state.song.layers);
  const undullFloor = dullFloorForCover();

  const previous = gl.getRenderTarget();
  gl.shadowMap.needsUpdate = true;
  gl.setRenderTarget(target);
  gl.render(scene, camera);
  gl.setRenderTarget(previous);
  gl.shadowMap.needsUpdate = true;

  unposeMeter();
  undullFloor();
  for (const object of away) object.visible = true;
  scene.remove(band);
  for (const mixer of mixers) mixer.stopAllAction();
  band.traverse((object) => {
    const skinned = object as SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
  });

  try {
    const pixels = new Uint16Array(source * source * 4);
    await gl.readRenderTargetPixelsAsync(target, 0, 0, source, source, pixels);
    return { size: COVER_SIZE, source, pixels, quality: 0.9 };
  } finally {
    target.dispose();
  }
}

class Darkroom {
  private worker = new Worker(new URL('../coverDevelop.worker.ts', import.meta.url), { type: 'module' });
  private queue: Promise<unknown> = Promise.resolve();

  develop(job: DevelopJob): Promise<Blob> {
    const run = () => new Promise<Blob>((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<DevelopAnswer>) => {
        if ('blob' in event.data) resolve(event.data.blob);
        else reject(new Error(event.data.error));
      };
      this.worker.onerror = (event) => reject(new Error(event.message));
      this.worker.postMessage(job, [job.pixels.buffer]);
    });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  close() {
    this.worker.terminate();
  }
}
