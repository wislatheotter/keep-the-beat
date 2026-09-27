import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { Object3D } from 'three';
import { THEME_IDS } from '@loop/shared';
import { setRehearsing } from '../backstage';

const SETTLE_FRAMES = 24;

const REVEAL_AFTER_FRAMES = 4;

const REVEAL_AFTER_REHEARSAL = THEME_IDS.length + 1 + REVEAL_AFTER_FRAMES;

const UNCULLED_FRAME = 2;

export function Standby({ onParked, onSettled, rehearse }: {
  onParked: () => void;
  onSettled: () => void;
  rehearse: boolean;
}) {
  const frames = useRef(0);
  const parked = useRef(false);
  const scene = useThree((three) => three.scene);
  const unculled = useRef<Object3D[]>([]);
  const cull = () => {
    for (const object of unculled.current) object.frustumCulled = true;
    unculled.current = [];
  };
  useEffect(() => cull, []);

  useEffect(() => {
    if (!rehearse) return;
    return () => setRehearsing(null);
  }, [rehearse]);

  useFrame(() => {
    frames.current += 1;
    if (rehearse) setRehearsing(THEME_IDS[frames.current - 1] ?? null);
    if (rehearse && frames.current === UNCULLED_FRAME) {
      scene.traverse((object) => {
        if (!object.frustumCulled) return;
        object.frustumCulled = false;
        unculled.current.push(object);
      });
    } else if (unculled.current.length) {
      cull();
    }
    if (frames.current === (rehearse ? REVEAL_AFTER_REHEARSAL : REVEAL_AFTER_FRAMES)) onSettled();
    if (frames.current >= SETTLE_FRAMES && !parked.current) {
      parked.current = true;
      onParked();
    }
  });

  return null;
}
