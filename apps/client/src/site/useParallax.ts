import { useEffect, useRef } from 'react';

const DRIFTING = '.site-backdrop > *, .hero-art, .hero-record, .about-record';

const REACH = 14;
const EASE = 0.06;
const TILT_RANGE = 22;

export function useParallax<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let engaged = false;
    let frame = 0;
    let zero: { beta: number; gamma: number } | null = null;

    const clamp = (value: number) => Math.max(-1, Math.min(1, value));

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      engaged = true;
      targetX = clamp((event.clientX / window.innerWidth) * 2 - 1);
      targetY = clamp((event.clientY / window.innerHeight) * 2 - 1);
      start();
    };

    const onTilt = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return;
      zero ??= { beta: event.beta, gamma: event.gamma };
      engaged = true;
      targetX = clamp((event.gamma - zero.gamma) / TILT_RANGE);
      targetY = clamp((event.beta - zero.beta) / TILT_RANGE);
      start();
    };

    const tick = (time: number) => {
      const toX = engaged ? targetX : Math.sin(time / 5200) * 0.55;
      const toY = engaged ? targetY : Math.cos(time / 7100) * 0.45;
      x += (toX - x) * EASE;
      y += (toY - y) * EASE;
      const px = `${(x * REACH).toFixed(2)}px`;
      const py = `${(y * REACH).toFixed(2)}px`;
      for (const node of el.querySelectorAll<HTMLElement>(DRIFTING)) {
        node.style.setProperty('--px', px);
        node.style.setProperty('--py', py);
      }
      if (engaged && Math.abs(toX - x) < 0.001 && Math.abs(toY - y) < 0.001) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('deviceorientation', onTilt);
    start();

    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onTilt);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return ref;
}
