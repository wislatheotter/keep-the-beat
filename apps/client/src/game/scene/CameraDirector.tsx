import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { livePlayer } from '../interaction';
import {
  finaleCut,
  finaleRise,
  followShot,
  introProgress,
  makeShot,
  outroProgress,
  replayShot,
  sectionAgeMs,
  stageMode,
  window01,
  type Shot,
  type StageMode,
} from '../stage';
import { DEV_HANDLE } from '../../runtime/devFlag';
import { tourFrame, tourShot } from '../lobbyTour';

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const SECTION_LEAN_MS = 520;

export function CameraDirector() {
  const runtime = useGameRuntime();
  const camera = useThree((three) => three.camera) as PerspectiveCamera;
  const size = useThree((three) => three.size);

  const want = useRef(makeShot()).current;
  const blendTo = useRef(makeShot()).current;
  const from = useRef<Shot | null>(null);
  const look = useRef(new Vector3(0, 1.5, 0)).current;
  const lastMode = useRef<StageMode | null>(null);
  const lastRuntime = useRef(runtime);
  const spawn = useRef(new Vector3()).current;
  const scratch = useRef(new Vector3()).current;

  useFrame((_, delta) => {
    const state = runtime.getState();
    const now = runtime.now();
    const aspect = size.width / Math.max(1, size.height);
    const mode = stageMode(state, now);
    const me = state.players[runtime.playerId];
    if (lastRuntime.current !== runtime) {
      lastRuntime.current = runtime;
      lastMode.current = null;
    }
    const entering = mode !== lastMode.current;
    const first = lastMode.current === null;
    lastMode.current = mode;

    if (entering && (mode === 'intro' || mode === 'outro')) {
      const snapshot = makeShot();
      snapshot.position.copy(camera.position);
      snapshot.target.copy(look);
      snapshot.fov = camera.fov;
      from.current = first ? null : snapshot;
    }

    let rate = 6.5;
    switch (mode) {
      case 'lobby': {
        tourShot(aspect, Object.keys(state.players).length, tourFrame.sample, want, me ? tourFrame.demo?.spot ?? null : null);
        rate = first ? Infinity : 2.6;
        break;
      }
      case 'intro': {
        const t = introProgress(state, now);
        spawn.set(me?.position.x ?? 0, me?.position.y ?? 0.75, me?.position.z ?? 8);
        followShot(spawn, aspect, blendTo);
        const start = from.current ?? blendTo;
        const pop = tourFrame.popIntro;
        const k = pop ? window01(t, 0.1, 0.58) : window01(t, 0.1, 0.9);
        want.position.lerpVectors(start.position, blendTo.position, k);
        want.position.y += Math.sin(k * Math.PI) * (pop ? 2.6 : 1.6);
        want.target.lerpVectors(start.target, blendTo.target, pop ? window01(t, 0.08, 0.55) : window01(t, 0.05, 0.8));
        want.fov = MathUtils.lerp(start.fov, blendTo.fov, k);
        rate = Infinity;
        break;
      }
      case 'show': {
        followShot(livePlayer.known ? livePlayer.position : spawn.set(me?.position.x ?? 0, 0.75, me?.position.z ?? 8), aspect, want);
        break;
      }
      case 'outro': {
        if (finaleCut(state, now)) {
          replayShot(aspect, want, 1 + 0.08 * (1 - easeOutCubic(finaleRise(state, now))));
        } else {
          const start = from.current;
          if (start) {
            const drift = window01(outroProgress(state, now), 0, 0.45) * 0.06;
            want.target.copy(start.target);
            want.position.copy(start.position).sub(start.target).multiplyScalar(1 + drift).add(start.target);
            want.fov = start.fov;
          } else {
            replayShot(aspect, want);
          }
        }
        rate = Infinity;
        break;
      }
      case 'replay': {
        const age = sectionAgeMs(state, now);
        const lean = age < SECTION_LEAN_MS ? (1 - age / SECTION_LEAN_MS) ** 2 : 0;
        replayShot(aspect, want, 1 - 0.022 * lean);
        rate = Infinity;
        break;
      }
    }

    let holdUp: number[] | undefined;
    if (DEV_HANDLE) {
      const hold = (window as unknown as { __loop?: { camera?: { position: number[]; target: number[]; fov?: number; up?: number[] } } }).__loop?.camera;
      if (hold) {
        want.position.fromArray(hold.position);
        want.target.fromArray(hold.target);
        want.fov = hold.fov ?? want.fov;
        holdUp = hold.up;
        rate = Infinity;
      }
    }

    const k = rate === Infinity ? 1 : 1 - Math.exp(-delta * rate);
    camera.position.lerp(want.position, k);
    if (mode === 'show') look.copy(want.target);
    else look.lerp(want.target, k);
    const steep = scratch.subVectors(look, camera.position).normalize().y < -0.8;
    camera.up.set(0, steep ? 0 : 1, steep ? -1 : 0);
    if (holdUp) camera.up.fromArray(holdUp);
    camera.lookAt(look);

    if (Math.abs(camera.fov - want.fov) > 0.01) {
      camera.fov += (want.fov - camera.fov) * (rate === Infinity ? 1 : Math.min(1, delta * 4));
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
