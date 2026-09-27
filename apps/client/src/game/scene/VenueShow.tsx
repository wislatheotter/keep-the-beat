import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Color, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, Object3D } from 'three';
import { replayClock, theme } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { beatInfo, crowdCheer, showEnergy } from '../beat';
import { audioFrame } from '../audioMeter';
import { decorativeMotion } from '../motion';
import { PERFORMANCE } from '../performance';
import { DeckParticles } from './DeckFx';
import { finaleCut } from '../stage';

const COUNT = PERFORMANCE.tier === 'low' ? 48 : 96;
const FLECKS = PERFORMANCE.tier === 'low' ? 64 : 220;
const CANNONS = [[-14.5, -6], [14.5, -6], [-8.7, -15.6], [8.7, -15.6]] as const;

export function VenueShow() {
  const state = useGameStateWhen((room) => room.themeId);
  const runtime = useGameRuntime();
  const look = theme(state.themeId).look;
  const event = useRef({ count: state.song.committed.length, replay: -1, at: -Infinity, nextJet: 0 });
  const props = useMemo(() => {
    const make = (count: number, dimensions: [number, number, number]) => {
      const mesh = new InstancedMesh(new BoxGeometry(...dimensions), new MeshBasicMaterial({ toneMapped: false, side: DoubleSide }), count);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      return mesh;
    };
    return { lamps: make(COUNT, [.15, .12, .13]), confetti: make(FLECKS, [.12, .2, .012]), sparks: new DeckParticles(PERFORMANCE.tier === 'low' ? 100 : 300),
      dummy: new Object3D(), color: new Color(), a: new Color(look.accent), b: new Color(look.secondary), white: new Color('#ffffff'),
      paper: Array.from({ length: FLECKS }, (_, i) => ({
        x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, spin: (i % 7 + 1) * .7, alive: 0,
      })),
    };
  }, []);
  useEffect(() => {
    props.a.set(look.accent);
    props.b.set(look.secondary);
  }, [look.accent, look.secondary, props]);
  useEffect(() => () => {
    for (const mesh of [props.lamps, props.confetti]) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }
    props.sparks.dispose();
  }, [props]);
  useFrame(({ clock }, delta) => {
    const state = runtime.getState();
    const now = runtime.now(), time = clock.elapsedTime, dt = Math.min(delta, .05);
    const motion = decorativeMotion(), beat = beatInfo(state, now), energy = showEnergy(state, now);
    const cheer = crowdCheer(state, now), audio = audioFrame(state, beat, time);
    const replay = replayClock(state, now)?.section ?? -1;
    const printed = state.song.committed.length > event.current.count;
    const replayChange = replay >= 0 && replay !== event.current.replay;
    if (printed || replayChange) {
      event.current.at = now;
      event.current.nextJet = 0;
      props.paper.forEach((p, i) => {
        const cannon = CANNONS[i % CANNONS.length]!;
        const spread = Math.sin(i * 127.1) * .5 + .5;
        p.x = cannon[0]; p.y = .85; p.z = cannon[1];
        p.vx = -Math.sign(cannon[0]) * (1 + spread * 3);
        p.vy = (5 + spread * 6) * motion;
        p.vz = 2 + Math.cos(i * 31.7) * 3;
        p.alive = motion > .5 ? 3 + spread * 2 : 0;
      });
    }
    event.current.count = state.song.committed.length;
    event.current.replay = replay;
    const since = now - event.current.at;
    const burst = since >= 0 && since < 1800 ? (1 - since / 1800) : 0;
    while (motion > .5 && event.current.nextJet < 4 && since >= event.current.nextJet * 150 && since < 900) {
      const i = event.current.nextJet++;
      const at = CANNONS[i]!;
      const count = PERFORMANCE.tier === 'low' ? 15 : 45;
      for (let j = 0; j < count; j++) {
        const k = j / count;
        props.sparks.emit({ x: at[0], y: 1, z: at[1], vx: Math.sin(j*5.1)*1.8, vy: 5+k*7, vz: Math.cos(j*3.7)*1.8,
          color: j%3 ? props.a : props.b, life: .6+k*.7, size: .13+k*.14, gravity: 9 });
      }
    }
    props.sparks.update(dt, time);
    const { dummy, color, lamps, confetti } = props;
    for (let i = 0; i < COUNT; i++) {
      const t = i / (COUNT - 1), a = (3 + t * 174) * Math.PI / 180;
      const band = audio.bands[Math.floor(t * (audio.bands.length - 1))]!;
      const chase = Math.max(0, Math.cos(t * Math.PI * 6 - (beat.beat + beat.beatPhase) * .8));
      const height = .09 + (.12 + band * .35) * energy * motion;
      dummy.position.set(Math.cos(a)*20.04, 6.99, -Math.sin(a)*20.04);
      dummy.rotation.set(0, Math.PI/2-a, 0);
      dummy.scale.set(1,height/.12,1);
      dummy.updateMatrix(); lamps.setMatrixAt(i,dummy.matrix);
      color.copy(props.a).lerp(props.b, (Math.sin(t*Math.PI*4)+1)/2).multiplyScalar(.35 + energy*.7 + chase*.5*motion + burst*1.6);
      lamps.setColorAt(i,color);
    }
    let any = false;
    props.paper.forEach((p,i) => {
      if (p.alive > 0) {
        any = true; p.alive -= dt; p.vy -= dt * 4;
        p.x += p.vx*dt + Math.sin(time*3+i)*dt*.6; p.y += p.vy*dt; p.z += p.vz*dt;
        if (p.y < .05) p.alive = 0;
      }
      dummy.position.set(p.x,p.y,p.z); dummy.rotation.set(time*p.spin,i+time*p.spin*.7,time*.5);
      dummy.scale.setScalar(p.alive > 0 ? Math.min(1,p.alive*2) : 0);
      dummy.updateMatrix(); confetti.setMatrixAt(i,dummy.matrix);
      color.copy(i%3 ? props.a : props.b).lerp(props.white, i%5===0 ? .7 : 0).multiplyScalar(.75 + cheer*.35);
      confetti.setColorAt(i,color);
    });
    confetti.visible = any;
    lamps.visible = !finaleCut(state, now);
    for (const mesh of [lamps,confetti]) {mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor!.needsUpdate=true;}
  });
  return <group><primitive object={props.lamps}/><primitive object={props.confetti}/><primitive object={props.sparks.points}/></group>;
}
