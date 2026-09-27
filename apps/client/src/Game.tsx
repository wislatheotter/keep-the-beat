import { FrozenGameState, GameRuntimeProvider } from './runtime/GameRuntimeContext';
import { ShowAudioProvider } from './audio/ShowAudioProvider';
import { AudiotoolProvider } from './audiotool/AudiotoolProvider';
import { LobbyOverlay } from './overlay/Lobby';
import { GameScene } from './game/GameScene';
import { GameHUD } from './overlay/GameHUD';
import { ReplayHUD } from './overlay/ReplayHUD';
import { useStageMode } from './overlay/useStageMode';
import { useKeyboardSteer } from './game/steer';
import { useBackstage } from './game/backstage';
import type { GameRuntime } from './runtime/GameRuntime';

export default function Game({ runtime, onLeave, backstage = false }: {
  runtime: GameRuntime;
  onLeave: () => void;
  backstage?: boolean;
}) {
  return (
    <GameRuntimeProvider runtime={runtime}>
      <ShowAudioProvider>
        <AudiotoolProvider>
          <Session onLeave={onLeave} backstage={backstage} />
        </AudiotoolProvider>
      </ShowAudioProvider>
    </GameRuntimeProvider>
  );
}

function Session({ onLeave, backstage }: { onLeave: () => void; backstage: boolean }) {
  useKeyboardSteer(!backstage);
  const mode = useStageMode();
  const dressed = useBackstage((store) => store.dressed);
  return (
    <div className={`game-shell is-${mode}${backstage ? ' is-backstage' : ''}${backstage && !dressed ? ' is-unpainted' : ''}`} inert={backstage}>
      <FrozenGameState frozen>
        <GameScene />
      </FrozenGameState>
      <FrozenGameState frozen={mode !== 'lobby' && mode !== 'intro'}>
        <LobbyOverlay leaving={mode === 'intro'} asleep={mode !== 'lobby' && mode !== 'intro'} onLeave={onLeave} />
      </FrozenGameState>
      {!backstage && (mode === 'lobby' || mode === 'intro' || mode === 'show') && (
        <FrozenGameState frozen={mode !== 'show'}>
          <GameHUD onLeave={onLeave} dormant={mode !== 'show'} />
        </FrozenGameState>
      )}
      {!backstage && (mode === 'outro' || mode === 'replay') && <ReplayHUD entering={mode === 'outro'} onLeave={onLeave} />}
    </div>
  );
}
