import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, Group,
  InstancedMesh, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, PlaneGeometry, SRGBColorSpace, type PerspectiveCamera, type ShaderMaterial,
} from 'three';
import { SECTION_PLAN, canPrint, songArcSlot, theme } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { lobbyCharge, useLobbyStage } from '../lobbyStage';
import { beatInfo } from '../beat';
import { decorativeMotion } from '../motion';
import { useFocusStore } from '../interaction';
import { PERFORMANCE } from '../performance';
import { emitBurst } from '../sparks';
import { DeckParticles, shaftGeometry, shaftMaterial, waveGeometry, waveMaterial } from './DeckFx';
import { markScenery } from './sceneryBatches';

export const SONG_ARC_FILE = '/stations/song-arc.glb';
const FILE = SONG_ARC_FILE;
const PALETTE = ['#67ebdb', '#aa8aff', '#ff8eab', '#ffd177', '#92e9ae'];
const COLORS = SECTION_PLAN.map((_, i) => new Color(PALETTE[i % PALETTE.length]!));
const WHITE = new Color('#fff4de');
const LAMPS = 80;
const scratch = new Object3D();
const tint = new Color();

export function SongArc() {
  const state = useGameStateWhen((room) => room.themeId);
  const runtime = useGameRuntime();
  const look = theme(state.themeId).look;
  const { scene } = useGLTF(FILE, '/draco/') as unknown as { scene: Group };
  const model = useMemo(() => {
    const owned = new Set<MeshStandardMaterial>();
    const shared = new Map<string, MeshStandardMaterial>();
    const baseColors = new Map<string, Color>();
    const piece = (name: string, color?: Color) => {
      const source = scene.getObjectByName(name);
      if (!source) throw new Error(`song-arc.glb has no ${name}`);
      const root = markScenery(source.clone(true));
      root.position.set(0, 0, 0);
      const paints = new Map<string, MeshStandardMaterial>();
      root.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const sourceMaterial = object.material as MeshStandardMaterial;
        const kind = sourceMaterial.name.split('.')[1]!;
        const personal = color && ['Glow', 'Label'].includes(kind);
        const cache = personal ? paints : shared;
        let material = cache.get(kind);
        if (!material) {
          material = sourceMaterial.clone();
          if (personal) {
            material.color.copy(color);
            material.emissive.copy(color);
            material.emissiveIntensity = 0.2;
            material.toneMapped = false;
          }
          material.envMapIntensity = 0.8;
          cache.set(kind, material);
          if (!personal) baseColors.set(kind, material.color.clone());
          owned.add(material);
        }
        object.material = material;
        object.castShadow = PERFORMANCE.shadows && (object.name.includes('Static') || !!object.parent?.name.includes('Static'));
        object.receiveShadow = true;
      });
      return { root, paints };
    };
    const base = piece('SongArc_Base').root;
    const slots = SECTION_PLAN.map((_, i) => {
      const { root, paints } = piece('SongArc_Slot', COLORS[i]!);
      const at = songArcSlot(i);
      root.name = `song-arc-slot-${i}`;
      root.position.set(at.x, 0, at.z);
      root.rotation.y = Math.atan2(at.x, at.z);
      const part = (name: string) => {
        const found = root.getObjectByName(name);
        if (!found) throw new Error(`song arc slot has no ${name}`);
        return found;
      };
      const record = part('Slot_Record');
      const orbit = part('Slot_Orbit');
      const arrow = part('Slot_Arrow');
      record.name = `song-arc-record-${i}`;
      arrow.name = `song-arc-arrow-${i}`;
      return { root, record, orbit, arrow, glow: paints.get('Glow')!, label: paints.get('Label')! };
    });
    return { base, slots, shared, owned, baseColors };
  }, [scene]);
  useEffect(() => {
    const shell = model.shared.get('Shell');
    const shellBase = model.baseColors.get('Shell');
    if (shell && shellBase) shell.color.copy(shellBase).lerp(tint.set(look.accent), 0.18);
    const rail = model.shared.get('Rail');
    if (rail) {
      rail.color.set(look.secondary);
      rail.emissive.set(look.secondary);
    }
  }, [look.accent, look.secondary, model]);

  const fx = useMemo(() => {
    const particles = new DeckParticles(PERFORMANCE.tier === 'low' ? 96 : 240);
    const material = new MeshBasicMaterial({ toneMapped: false });
    const lamps = new InstancedMesh(new BoxGeometry(.095, .055, .16), material, LAMPS);
    lamps.name = 'song-arc-chase-lights';
    lamps.instanceMatrix.setUsage(DynamicDrawUsage);
    lamps.frustumCulled = false;
    for (let i = 0; i < LAMPS; i++) lamps.setColorAt(i, WHITE);
    const waves = SECTION_PLAN.map((_, i) => {
      const at = songArcSlot(i);
      const wave = new Mesh(waveGeometry, waveMaterial(PALETTE[i % PALETTE.length]!));
      wave.rotation.x = -Math.PI / 2;
      wave.position.set(at.x, 1.42, at.z);
      wave.visible = false;
      const beam = new Mesh(shaftGeometry, shaftMaterial(PALETTE[i % PALETTE.length]!));
      beam.position.set(at.x, 1.44, at.z);
      beam.scale.set(.56, .48, .56);
      beam.visible = false;
      return { wave, beam };
    });
    return { particles, lamps, waves };
  }, []);

  const plaques = useMemo(() => SECTION_PLAN.map((section, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#111623'; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = PALETTE[i % PALETTE.length]!;
    ctx.font = '800 56px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${String(i + 1).padStart(2, '0')}  ${section.name}`, 256, 67);
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map, toneMapped: false, side: DoubleSide });
    const mesh = new Mesh(new PlaneGeometry(1.85, .40), material);
    const at = songArcSlot(i), angle = Math.atan2(at.x, at.z);
    mesh.position.set(at.x + Math.sin(angle) * .68, .77, at.z + Math.cos(angle) * .68);
    mesh.rotation.set(0, angle, 0);
    return mesh;
  }), []);

  useEffect(() => () => {
    model.owned.forEach(m => m.dispose());
  }, [model]);
  useEffect(() => () => {
    fx.particles.dispose(); fx.lamps.geometry.dispose(); (fx.lamps.material as MeshBasicMaterial).dispose();
    fx.waves.forEach(({ wave, beam }) => { wave.material.dispose(); beam.material.dispose(); });
    plaques.forEach(p => { p.geometry.dispose(); p.material.map?.dispose(); p.material.dispose(); });
  }, [fx, plaques]);

  const seen = useRef(state.song.committed.length);
  const flashes = useRef(SECTION_PLAN.map(() => -Infinity));
  const nextGlint = useRef(0);
  const charge = useRef(0);

  useFrame(({ camera, size }, delta) => {
    const current = runtime.getState();
    const now = runtime.now(), time = now / 1000, dt = Math.min(delta, .05);
    const motion = decorativeMotion(), reduced = motion < 1;
    const lobby = current.phase === 'lobby';
    const demo = lobby ? useLobbyStage.getState() : null;
    const count = demo ? (demo.printed ? 1 : 0) : current.song.committed.length;
    const beat = beatInfo(current, now);
    const demoCharge = demo ? lobbyCharge(now) : 0;
    const ready = demo ? demoCharge > 0 : current.phase === 'playing' && canPrint(current, now);
    const focus = demo ? demoCharge > 0 : useFocusStore.getState().focus.kind === 'print';
    charge.current = MathUtils.damp(charge.current, demo ? demoCharge : current.commitProgress, 20, dt);

    if (count < seen.current) { flashes.current.fill(-Infinity); charge.current = 0; }
    if (count > seen.current) {
      for (let i = seen.current; i < count; i++) {
        flashes.current[i] = now;
        if (i === SECTION_PLAN.length - 1) {
          for (let previous = 0; previous < i; previous++) flashes.current[previous] = now + (i - previous) * 70;
        }
        const at = songArcSlot(i);
        if (!reduced) {
          for (let n = 0; n < (PERFORMANCE.tier === 'low' ? 32 : 80); n++) {
            const a = n * 2.39996, speed = .6 + Math.random() * 2.2;
            fx.particles.emit({ x: at.x, y: 1.7, z: at.z,
              vx: Math.cos(a) * speed, vy: 2 + Math.random() * 4, vz: Math.sin(a) * speed * .6,
              color: n % 4 === 0 ? WHITE : COLORS[n % COLORS.length]!,
              life: .8 + Math.random() * .8, size: .13 + Math.random() * .16, gravity: 4.5 });
          }
          emitBurst({ ...at, y: 2 }, PALETTE[i % PALETTE.length]!, { count: 20, speed: 2.6, lift: 5, life: 1.2, size: 1.5 });
        }
      }
    }
    seen.current = count;

    model.slots.forEach((slot, i) => {
      const kept = i < count, active = i === current.song.sectionIndex && (current.phase === 'playing' || (lobby && ready));
      const age = (now - flashes.current[i]!) / 1000;
      const celebrating = age >= 0 && age < 1.6;
      const pop = celebrating ? Math.sin(Math.min(age / .6, 1) * Math.PI) * Math.exp(-age * 2) : 0;
      const swell = celebrating ? Math.exp(-age * 3) : 0;
      const holding = active ? charge.current : 0;
      slot.record.visible = kept;
      slot.record.position.y = 1.67 + (kept ? .18 + Math.sin(time * 1.5 + i) * .045 : 0) * motion + pop * .7 * motion;
      slot.record.rotation.y += dt * (kept ? .3 + swell * 8 : 0) * (reduced ? 0 : 1);
      slot.record.rotation.x = .16 * motion;
      slot.orbit.visible = kept || active;
      slot.orbit.position.y = 1.52 + (kept ? .33 : holding * .4) * motion;
      slot.orbit.rotation.x = (kept ? Math.sin(time * .8 + i) * .22 : 0) * motion;
      slot.orbit.rotation.z = (kept ? Math.cos(time * .8 + i) * .16 : 0) * motion;
      slot.orbit.rotation.y -= dt * (.35 + holding * 5 + swell * 7) * (reduced ? 0 : 1);
      slot.orbit.scale.setScalar(1 + (holding * .14 + pop * .35) * motion);
      slot.glow.emissiveIntensity = kept ? .65 + beat.pulse * .3 * motion + swell * 1.8 * motion
        : active ? .25 + (ready ? .2 : 0) + holding * 1.5 : .025;
      slot.glow.color.copy(COLORS[i]!).multiplyScalar(kept || active ? 1 : .22);
      slot.label.emissiveIntensity = kept ? .4 + swell : .03;
      slot.arrow.visible = active && ready;
      slot.arrow.position.y = 2.9 + (Math.sin(time * 3) * .10 - holding * .3) * motion;
      slot.arrow.scale.setScalar(MathUtils.damp(slot.arrow.scale.x, focus ? 1.1 : .8, 15, dt));
      const { wave, beam } = fx.waves[i]!;
      const waveT = Math.max(0, Math.min(1, age / .9));
      wave.visible = celebrating && age < .9 && !reduced;
      wave.scale.setScalar(.65 + (1 - (1 - waveT) ** 3) * 2.3);
      wave.material.opacity = (1 - waveT) ** 2 * .65;
      beam.visible = PERFORMANCE.tier !== 'low' && !reduced && (holding > .02 || celebrating);
      beam.material.uniforms.uIntensity!.value = holding * .5 + swell * 1.8;
    });

    for (let i = 0; i < LAMPS; i++) {
      const angle = -.415 + i / (LAMPS - 1) * .83;
      scratch.position.set(Math.sin(angle) * 15.78, 1.24, Math.cos(angle) * 15.78);
      scratch.rotation.set(0, angle, 0); scratch.scale.set(1, 1, 1); scratch.updateMatrix();
      fx.lamps.setMatrixAt(i, scratch.matrix);
      const section = Math.min(COLORS.length - 1, Math.floor(i / LAMPS * COLORS.length));
      const local = (i / LAMPS * COLORS.length) % 1;
      const age = (now - flashes.current[section]!) / 1000;
      const flash = age >= 0 ? Math.exp(-age * 2.5) : 0;
      const chase = reduced ? 0 : Math.max(0, Math.cos(i * .3 - time * 2)) ** 12;
      const fill = section === current.song.sectionIndex && local <= charge.current && charge.current > 0;
      tint.copy(COLORS[section]!).multiplyScalar(.16 + (section < count ? .6 : .08) + chase * .5 + (fill ? 1.6 : 0) + flash * 2 * motion);
      fx.lamps.setColorAt(i, tint);
    }
    fx.lamps.instanceMatrix.needsUpdate = true;
    fx.lamps.instanceColor!.needsUpdate = true;
    model.shared.get('Rail')!.emissiveIntensity = .5 + beat.pulse * .2 * motion;
    if (!reduced && now > nextGlint.current) {
      nextGlint.current = now + (charge.current > .01 ? 45 : 280);
      const i = Math.min(current.song.sectionIndex, SECTION_PLAN.length - 1);
      const at = songArcSlot(i), a = time * 4;
      if (ready || count > 0) fx.particles.emit({
        x: at.x + Math.sin(a) * .7, y: 1.5, z: at.z + Math.cos(a) * .7,
        vx: 0, vy: .35 + charge.current * 2, vz: 0, color: COLORS[i]!,
        life: .8, size: .10, swirl: .06,
      });
    }
    (fx.particles.points.material as ShaderMaterial).uniforms.uScale!.value = size.height / (2 * Math.tan(MathUtils.degToRad((camera as PerspectiveCamera).fov / 2)));
    fx.particles.update(dt, time);
  });

  return <group name="song-arc">
    <primitive object={model.base} />
    {model.slots.map((slot, i) => <primitive key={i} object={slot.root} />)}
    {plaques.map((mesh, i) => <primitive key={i} object={mesh} />)}
    <primitive object={fx.lamps} />
    {fx.waves.map(({ wave, beam }, i) => <group key={i}><primitive object={wave} /><primitive object={beam} /></group>)}
    <primitive object={fx.particles.points} />
  </group>;
}

useGLTF.preload(FILE, '/draco/');
