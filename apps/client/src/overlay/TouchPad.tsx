import { memo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { steer } from '../game/steer';

export const TouchPad = memo(function TouchPad() {
  const root = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [held, setHeld] = useState(false);

  const update = (clientX: number, clientY: number) => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width * 0.34;
    let x = clientX - cx;
    let y = clientY - cy;
    const length = Math.hypot(x, y);
    if (length > radius) { x = x / length * radius; y = y / length * radius; }
    setKnob({ x, y });
    steer(x / radius, y / radius);
  };

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    setHeld(false);
    setKnob({ x: 0, y: 0 });
    steer(0, 0);
  };

  return (
    <div
      ref={root}
      className={`hud-stick${held ? ' is-held' : ''}`}
      aria-label="Move"
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        pointerId.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        setHeld(true);
        update(event.clientX, event.clientY);
      }}
      onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (pointerId.current !== event.pointerId) return;
        update(event.clientX, event.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <div className="hud-stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
});
