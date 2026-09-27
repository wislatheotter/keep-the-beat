import { useFrame } from '@react-three/fiber';
import { Vector2 } from 'three';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { beatInfo } from '../beat';
import { decorativeMotion } from '../motion';
import { tickRecordClock } from './recordMaterial';

let seconds = 0;

export function RecordClock() {
  const runtime = useGameRuntime();
  useFrame((three, delta) => {
    const motion = decorativeMotion();
    seconds += Math.min(delta, 0.1) * motion;
    const beat = beatInfo(runtime.getState(), runtime.now());
    const running = motion === 1 && (beat.beat > 0 || beat.beatPhase > 0);
    const beats = running ? beat.beat + beat.beatPhase : seconds * 2;
    const pulse = running ? beat.pulse : (1 - ((seconds * 2) % 1)) ** 2.6;
    tickRecordClock(seconds, beats, pulse * motion, three.gl.getDrawingBufferSize(size).y);
  }, -1);
  return null;
}

const size = new Vector2();
