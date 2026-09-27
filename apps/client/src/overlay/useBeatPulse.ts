import { useEffect, useRef, type RefObject } from 'react';
import { useGameRuntime } from '../runtime/GameRuntimeContext';
import { beatInfo } from '../game/beat';

export function useBeatPulse(target: RefObject<HTMLElement | null>, running = true) {
  const runtime = useGameRuntime();
  const quiet = useRef(false);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    quiet.current = motion.matches;
    const listen = () => { quiet.current = motion.matches; };
    motion.addEventListener('change', listen);
    return () => motion.removeEventListener('change', listen);
  }, []);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let written = -1;
    const tick = () => {
      const node = target.current;
      if (node) {
        const pulse = quiet.current ? 0 : beatInfo(runtime.getState(), runtime.now()).pulse;
        const steps = Math.round(pulse / STEP);
        if (steps !== written) {
          written = steps;
          node.style.setProperty('--pulse', PULSES[steps] ?? '0');
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [runtime, target, running]);
}

const STEP = 0.02;
const PULSES = Array.from({ length: Math.round(1 / STEP) + 1 }, (_, i) => (i * STEP).toFixed(2));
