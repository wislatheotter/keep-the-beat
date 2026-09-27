import { useFrame } from '@react-three/fiber';
import { useRef, useState } from 'react';
import type { Group } from 'three';
import { replayClock, sample as gameSample, type LoopLayer } from '@loop/shared';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { beatInfo } from '../beat';
import { discKey, platterMoment, type Disc } from '../replayDeck';
import { Vinyl } from './Vinyl';

export const REPLAY_RECORD_SCALE = 1.55;
const REST_Y = 0.2;

export function ReplayPlatter({ layer }: { layer: LoopLayer }) {
  const runtime = useGameRuntime();
  const [shown, setShown] = useState<{ current: Disc | null; incoming: Disc | null; outgoing: Disc | null }>({
    current: null,
    incoming: null,
    outgoing: null,
  });
  const shownKey = useRef('||');
  const current = useRef<Group>(null);
  const incoming = useRef<Group>(null);
  const outgoing = useRef<Group>(null);
  const spin = useRef(Math.random() * Math.PI * 2);

  useFrame((_, delta) => {
    const state = runtime.getState();
    const now = runtime.now();
    const clock = replayClock(state, now);
    if (!clock) return;
    const moment = platterMoment(state, clock, layer);
    const key = `${discKey(moment.current)}|${discKey(moment.incoming)}|${discKey(moment.outgoing)}`;
    if (key !== shownKey.current) {
      shownKey.current = key;
      setShown({ current: moment.current, incoming: moment.incoming, outgoing: moment.outgoing });
    }

    const beat = beatInfo(state, now);
    const windDown = clock.position < 0 ? Math.max(0, 1 + clock.position / 1.2) : 1;
    spin.current += delta * 1.6 * (clock.position < 0 ? windDown : 1);

    const node = current.current;
    if (node) {
      const punch = moment.landing * moment.landing;
      node.rotation.y = spin.current;
      node.position.y = REST_Y + punch * 0.18;
      node.scale.setScalar(REPLAY_RECORD_SCALE * (1 + punch * 0.16 + (clock.position >= 0 ? beat.pulse * 0.035 : 0)));
    }
    const down = incoming.current;
    if (down) {
      const u = moment.arriving;
      const fall = (1 - u) ** 2;
      down.position.y = REST_Y + fall * 3.4;
      down.rotation.set(fall * 1.1, spin.current + fall * 5, 0);
      down.scale.setScalar(REPLAY_RECORD_SCALE * (0.62 + 0.38 * u));
      down.visible = u > 0;
    }
    const off = outgoing.current;
    if (off) {
      const v = moment.leaving;
      off.position.set(0, REST_Y + Math.sin(v * Math.PI) * 1.3 + v * 0.6, v * v * 4.2 + v * 0.6);
      off.rotation.set(v * 3.2, spin.current, v * 1.4);
      off.scale.setScalar(REPLAY_RECORD_SCALE * Math.max(0.001, 1 - v * 0.8));
      off.visible = v < 1;
    }
  });

  return (
    <>
      <group ref={current} position={[0, REST_Y, 0]}>
        {shown.current && <ReplayDisc disc={shown.current} layer={layer} glow={0.6} />}
      </group>
      <group ref={incoming} visible={false}>
        {shown.incoming && <ReplayDisc disc={shown.incoming} layer={layer} glow={1} />}
      </group>
      <group ref={outgoing} visible={false}>
        {shown.outgoing && <ReplayDisc disc={shown.outgoing} layer={layer} glow={0.25} />}
      </group>
    </>
  );
}

function ReplayDisc({ disc, layer, glow }: { disc: Disc; layer: LoopLayer; glow: number }) {
  return (
    <Vinyl
      key={discKey(disc)}
      role={layer}
      sampleName={disc.sampleName}
      family={gameSample(disc.sampleName)?.family}
      fx={disc.fx}
      glow={glow}
    />
  );
}
