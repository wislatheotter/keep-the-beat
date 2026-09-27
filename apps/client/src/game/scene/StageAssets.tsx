import { useGLTF, useTexture } from '@react-three/drei';
import type { PropsWithChildren } from 'react';
import { DECK_FILE } from './deckModel';
import { BALL_FILE, BALL_TEXTURE } from './DiscoBall';
import { MACHINES_FILE } from './MachineStation';
import { DRACO_DECODER, MOVES_FILE, RIG_FILES } from './PerformerRig';
import { RECORDS_FILE } from './recordModel';
import { STATIONS_FILE } from './RecordStation';
import { SONG_ARC_FILE } from './SongArc';
import { VENUE_FILE } from './Venue';

const MODELS = [VENUE_FILE, DECK_FILE, STATIONS_FILE, MACHINES_FILE, SONG_ARC_FILE, RECORDS_FILE, BALL_FILE, MOVES_FILE, ...RIG_FILES];

export function StageAssets({ children }: PropsWithChildren) {
  for (const file of MODELS) useGLTF.preload(file, DRACO_DECODER);
  useTexture.preload(BALL_TEXTURE);

  for (const file of MODELS) useGLTF(file, DRACO_DECODER);
  useTexture(BALL_TEXTURE);
  return <>{children}</>;
}
