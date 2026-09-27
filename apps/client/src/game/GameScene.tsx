import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { NoToneMapping, SRGBColorSpace } from 'three';
import { ARENA_RADIUS, theme } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../runtime/GameRuntimeContext';
import { Arena } from './scene/Arena';
import { Deck } from './scene/Deck';
import { SongArc } from './scene/SongArc';
import { LeavingPerformers, LocalPlayer, RemotePlayer } from './scene/Performers';
import { CameraDirector } from './scene/CameraDirector';
import { ShowSet } from './scene/ShowSet';
import { useStageReady } from './stage';
import { MusicBlock } from './scene/MusicBlock';
import { VanishingRecords } from './scene/VanishingRecords';
import { RecordLights } from './scene/RecordLights';
import { Stations } from './scene/Stations';
import { Sparks, StageSparks } from './scene/Sparks';
import { FootFx } from './scene/FootFx';
import { LobArc, MouseAim } from './scene/LobArc';
import { PERFORMANCE } from './performance';
import { portraitReach } from './camera';
import { seeEveryLayer } from './layers';
import { SceneEnvironment } from './scene/SceneEnvironment';
import { PostFX, type PostWarmTarget } from './scene/PostFX';
import { ClubLights, RigClock } from './scene/ClubLights';
import { KeyLights } from './scene/KeyLights';
import { DevSceneHandle } from '../runtime/devHandle';
import { ShaderWarmup } from './scene/ShaderWarmup';
import { FramePacer } from './scene/FramePacer';
import { Standby } from './scene/Standby';
import { setDressed, useBackstage } from './backstage';
import { FocusTracker } from './scene/FocusTracker';
import { RecordClock } from './scene/RecordClock';
import { Guide } from './scene/Guide';
import { clearSparks } from './sparks';
import './loadReport';
import './lazyTransforms';
import { LobbyTour } from './scene/LobbyTour';
import { StageAssets } from './scene/StageAssets';
import { SceneryBatcher } from './scene/SceneryBatcher';
import { OffForReplay } from './scene/OffForReplay';
import { CoverShoot } from './scene/CoverShoot';

let rooms = 0;
const nextRoom = () => ++rooms;

export function GameScene() {
  const runtime = useGameRuntime();
  const state = useGameStateWhen((room) => [
    room.themeId, Object.keys(room.blocks), Object.keys(room.players), room.players[runtime.playerId]?.color,
  ]);
  const vibe = theme(state.themeId);
  const look = vibe.look;
  const [warm, setWarm] = useState(false);
  const backstage = useBackstage((store) => store.backstage);
  const [parked, setParked] = useState(false);
  const [rehearsed, setRehearsed] = useState(false);
  const parkedOnce = useCallback(() => { setParked(true); setRehearsed(true); setDressed(); }, []);
  const settled = useStageReady((store) => store.settled);
  const onSettled = useCallback(() => useStageReady.getState().setSettled(), []);
  const shown = useStageReady((store) => store.ready);
  const held = useStageReady((store) => store.holds > 0);
  const onCalm = useCallback(() => useStageReady.getState().setReady(), []);
  const [environmentReady, setEnvironmentReady] = useState(false);
  const [postTargets, setPostTargets] = useState<PostWarmTarget[] | null>(null);
  const environmentBuilt = useCallback(() => setEnvironmentReady(true), []);
  const postBuilt = useCallback((targets: PostWarmTarget[]) => setPostTargets(targets), []);
  const [entry, setEntry] = useState(0);
  useEffect(() => {
    setParked(false);
    useStageReady.getState().reset();
    setEntry((count) => count + 1);
  }, [backstage, runtime]);
  useEffect(() => () => useStageReady.getState().reset(), []);
  const room = useMemo(() => nextRoom(), [runtime]);
  useEffect(() => clearSparks(), [runtime]);

  return (
    <Canvas
      frameloop="never"
      shadows={PERFORMANCE.shadows ? 'percentage' : false}
      dpr={PERFORMANCE.dpr}
      camera={{ position: [0, 11.4, 13.1], fov: 42, near: 0.5, far: 160 }}
      gl={{
        antialias: PERFORMANCE.antialias,
        powerPreference: 'high-performance',
        alpha: false,
      }}
      onCreated={({ gl, camera }) => {
        gl.toneMapping = NoToneMapping;
        gl.outputColorSpace = SRGBColorSpace;
        gl.debug.checkShaderErrors = import.meta.env.DEV;
        seeEveryLayer(camera);
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={[look.night]} />
      <RoomFog color={look.night} near={ARENA_RADIUS * look.fogNear} far={ARENA_RADIUS * look.fogFar} />
      <SceneEnvironment onReady={environmentBuilt} />
      <DevSceneHandle />
      <Suspense fallback={null}>
        <StageAssets>
          <KeyLights accent={vibe.look.accent} look={look} />
          <RigClock />
          <RecordClock />
          <ClubLights />
          <Arena />
          <Deck />
          <OffForReplay>
            <SongArc />
            <Stations />
          </OffForReplay>
          {Object.keys(state.blocks).map((id) => <MusicBlock key={id} blockId={id} />)}
          <VanishingRecords key={`vanish:${room}`} />
          <RecordLights />
          <FocusTracker />
          <Guide />
          <LobbyTour />
          <Sparks />
          <StageSparks />
          <FootFx />
          <LobArc />
          <MouseAim />
          <ShowSet />
          <Suspense key={state.players[runtime.playerId]?.color ?? 'standby'} fallback={null}>
            <LocalPlayer />
          </Suspense>
          {Object.keys(state.players)
            .filter((id) => id !== runtime.playerId)
            .map((id) => <Suspense key={id} fallback={null}><RemotePlayer playerId={id} /></Suspense>)}
          <LeavingPerformers key={`leaving:${room}`} />
          <CameraDirector />
          <CoverShoot />
          <FramePacer
            running={warm && !(backstage && parked)}
            govern={!backstage && shown}
            gentle={backstage || !settled}
            onCalm={!backstage && settled && !held && !shown ? onCalm : undefined}
          />
          {PERFORMANCE.bloom && <PostFX onReady={postBuilt} />}
          {warm && !parked && <Standby key={entry} onParked={parkedOnce} onSettled={onSettled} rehearse={!rehearsed} />}
          <SceneryBatcher />
          {environmentReady && (!PERFORMANCE.bloom || postTargets) && (
            <ShaderWarmup postTargets={postTargets ?? []} onReady={() => setWarm(true)} />
          )}
        </StageAssets>
      </Suspense>
    </Canvas>
  );
}

function RoomFog({ color, near, far }: { color: string; near: number; far: number }) {
  const size = useThree((three) => three.size);
  const reach = portraitReach(size.width / Math.max(1, size.height));
  return <fog attach="fog" args={[color]} near={near + reach} far={far + reach} />;
}
