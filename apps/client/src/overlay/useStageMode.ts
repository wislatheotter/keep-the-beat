import { useEffect, useState } from 'react';
import { useGameRuntime } from '../runtime/GameRuntimeContext';
import { stageMode, type StageMode } from '../game/stage';

export function useStageMode(): StageMode {
  const runtime = useGameRuntime();
  const [mode, setMode] = useState<StageMode>(() => stageMode(runtime.getState(), runtime.now()));
  useEffect(() => {
    let frame = 0;
    let current = stageMode(runtime.getState(), runtime.now());
    setMode(current);
    const tick = () => {
      const next = stageMode(runtime.getState(), runtime.now());
      if (next !== current) {
        current = next;
        setMode(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [runtime]);
  return mode;
}
