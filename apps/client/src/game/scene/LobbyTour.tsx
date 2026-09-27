import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { theme } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { useBackstage } from '../backstage';
import { advanceTour, publishDemo, seekTour, tourFrame, tourLegs } from '../lobbyTour';
import { DEV_HANDLE } from '../../runtime/devFlag';
import { stageMode } from '../stage';
import { FloatingWord, type Word, type WordView } from './guideProps';
import { clearLobbyStage, crateRecords, driveLobbyStage, useLobbyStage } from '../lobbyStage';
import { fireStageSparks } from './Sparks';
import { MusicBlock } from './MusicBlock';

const NARROW_FRAME = { x: 0.08, top: 0.66 };
const WIDE_FRAME = { x: 0.55, top: 0.7 };

export function LobbyTour() {
  const runtime = useGameRuntime();
  const camera = useThree((three) => three.camera);
  const sign = useMemo(() => new FloatingWord(), []);
  const view = useMemo<WordView>(() => ({ camera: null!, width: 1, height: 1, host: null }), []);
  useEffect(() => () => sign.dispose(), [sign]);
  const want = useMemo<Word>(() => ({ key: '', text: '', chip: null, x: 0, y: 0, z: 0 }), []);

  useEffect(() => {
    if (!DEV_HANDLE) return;
    const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
    handle.tour = {
      legs: tourLegs,
      seek: (ms: number) => seekTour(ms, performance.now()),
      now: () => ({ ...tourFrame.sample }),
    };
    (window as unknown as { __loop?: unknown }).__loop = handle;
  }, []);

  useFrame((three, delta) => {
    const state = runtime.getState();
    const mode = stageMode(state, runtime.now());
    advanceTour(mode, useBackstage.getState().backstage, performance.now());
    const tour = tourFrame.sample;
    if (mode === 'lobby') {
      publishDemo(tourFrame.demo, runtime.now(), tour.stopMs);
      driveLobbyStage(tour, state.themeId, runtime.now(), camera, fireStageSparks);
    } else {
      clearLobbyStage();
    }
    const accent = theme(state.themeId).look.accent;
    const word = mode === 'lobby' && tour.word && tour.stopMs > 450 && tour.stopLeftMs > 500 ? tour.word : null;
    if (word) {
      want.key = `${tour.stop}|${tour.lap}|${word.text}`;
      want.text = word.text;
      want.chip = word.chip;
      want.x = word.x;
      want.y = word.y;
      want.z = word.z;
      want.size = word.size;
    }
    if (mode !== 'lobby' && mode !== 'intro') sign.clear();
    else {
      view.camera = three.camera;
      view.width = three.size.width;
      view.height = three.size.height;
      view.host = three.gl.domElement.parentElement;
      sign.update(word ? want : null, accent, delta, view, three.clock.elapsedTime, three.size.width < three.size.height ? NARROW_FRAME : WIDE_FRAME);
    }
  }, -2);

  return (
    <>
      <LobbyFloorRecord />
      <LobbyCrateRecords />
    </>
  );
}

function LobbyFloorRecord() {
  const record = useLobbyStage((stage) => (stage.record && (stage.record.status === 'thrown' || stage.record.status === 'world') ? stage.record : null));
  return record ? <MusicBlock key={record.id} blockId={record.id} block={record} /> : null;
}

function LobbyCrateRecords() {
  const state = useGameStateWhen((room) => [room.phase, room.themeId]);
  const takenAt = useLobbyStage((stage) => stage.takenAt);
  const records = useMemo(() => crateRecords(state.themeId, takenAt), [state.themeId, takenAt]);
  if (state.phase !== 'lobby') return null;
  return <>{records.map((record) => <MusicBlock key={record.id} blockId={record.id} block={record} />)}</>;
}
