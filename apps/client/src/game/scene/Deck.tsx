import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  RingGeometry,
  ShaderMaterial,
  type PointLight,
} from 'three';
import {
  DECK_PLINTH_RADIUS,
  DECK_POSITION,
  DECK_RING_RADIUS,
  LAYER_COLORS,
  LOOP_LAYERS,
  PHRASE_BARS,
  SECTION_PLAN,
  barPosition,
  barToTime,
  isOvertime,
  platterAngle,
  platterOffset,
  replayClock,
  sectionAtBar,
  sample as gameSample,
  showProgress,
  showRemainingMs,
  theme,
  type BlockState,
  type LoopLayer,
} from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { PERFORMANCE } from '../performance';
import { beatInfo, showEnergy, stagePower } from '../beat';
import { finaleCut, introProgress, window01 } from '../stage';
import { platterMoment } from '../replayDeck';
import { audioFrame } from '../audioMeter';
import { ReplayPlatter } from './ReplayPlatter';
import { Vinyl } from './Vinyl';
import { decorativeMotion } from '../motion';
import { auraPulse, createAuraMaterial, fadeAura } from '../aura';
import { useFocusStore } from '../interaction';
import { RecordPlace } from './Handoff';
import { DEMO_RECORD_ID, openingOnDeck, useLobbyStage } from '../lobbyStage';
import {
  DECK_TOP,
  HUB_RADIUS,
  HUB_SHOULDER_Y,
  HUB_TOP_Y,
  METER_AT,
  RECORD_Y,
  SLOT_TOP,
  useDeckModel,
} from './deckModel';
import {
  DeckParticles,
  METER_CELLS,
  lampRing,
  meterColumn,
  setLamp,
  shaftGeometry,
  shaftMaterial,
  waveGeometry,
  waveMaterial,
} from './DeckFx';

const quarterMarks = mergeGeometries([0, 0.25, 0.5, 0.75].map((turn) => {
  const mark = new BoxGeometry(0.09, 0.05, 0.36);
  mark.rotateY(turn * Math.PI * 2);
  mark.translate(Math.sin(turn * Math.PI * 2) * (DECK_RING_RADIUS + 0.14), 0.015, Math.cos(turn * Math.PI * 2) * (DECK_RING_RADIUS + 0.14));
  return mark;
}))!;
const quarterMaterial = new MeshBasicMaterial({ color: '#e8eefc', transparent: true, opacity: 0.6, toneMapped: false });

const DEAD = '#4e5665';
const OVERTIME_COLOR = '#ff3b5c';
const DUE = '#ffb23b';
const SEGMENTS = 24;
const RECORD_SCALE = 1.25;
const CLOCK_Y = DECK_TOP + 0.02;

const ARM_PLAY_OUTER = -0.36;
const ARM_PLAY_INNER = -0.5;
const SIDE_LAMPS = 48;
const SIDE_RADIUS = DECK_PLINTH_RADIUS - 0.2;
const EQ_BARS = 32;
const EQ_RADIUS = 1.47;
const METER_STEP = 0.125;
const LANDING_MS = 420;
const WAVE_MS = 700;

type SlotFx = {
  startedAt: number;
  waveAt: number;
  rippleAt: number;
  arm: number;
  lift: number;
  owed: number;
  shaft: number;
};

export function Deck() {
  const runtime = useGameRuntime();
  const state = useGameStateWhen((room) => [
    room.themeId, room.runSeed, room.phase,
    Object.values(room.blocks).filter((block) => block.status === 'deck').map((block) => [block.id, block.layer, block.role, block.sampleName, block.fx]),
    room.song.queued.map((change) => [change.layer, change.blockId]),
  ]);
  const look = theme(state.themeId).look;
  const song = state.song;
  const model = useDeckModel(look);
  const camera = useThree((three) => three.camera) as PerspectiveCamera;
  const viewport = useThree((three) => three.size);

  const needle = useRef<Group>(null);
  const deckLight = useRef<PointLight>(null);
  const dial = useMemo(() => clockRing(SEGMENTS), []);
  useEffect(() => () => dial.dispose(), [dial]);
  const records = useRef<Partial<Record<LoopLayer, Group>>>({});
  const slotRoots = useRef<Partial<Record<LoopLayer, Group>>>({});
  const platterLights = useRef<Partial<Record<LoopLayer, PointLight>>>({});
  const countdowns = useRef<Partial<Record<LoopLayer, Mesh>>>({});
  const shafts = useRef<Partial<Record<LoopLayer, Mesh>>>({});
  const waves = useRef<Partial<Record<LoopLayer, Mesh>>>({});
  const focus = useFocusStore((store) => store.focus);
  const halos = useMemo(
    () => Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, createAuraMaterial(LAYER_COLORS[layer])])) as Record<LoopLayer, MeshBasicMaterial>,
    [],
  );
  const ejectHalo = useMemo(() => createAuraMaterial('#ffffff'), []);
  useEffect(() => () => {
    ejectHalo.dispose();
    Object.values(halos).forEach(material => material.dispose());
  }, [ejectHalo, halos]);
  const countdownMaterials = useMemo(
    () => Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, countdownMaterial(LAYER_COLORS[layer])])) as Record<LoopLayer, ShaderMaterial>,
    [],
  );
  const shaftMaterials = useMemo(
    () => Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, shaftMaterial(LAYER_COLORS[layer])])) as Record<LoopLayer, ShaderMaterial>,
    [],
  );
  const waveMaterials = useMemo(
    () => Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, waveMaterial(LAYER_COLORS[layer])])) as Record<LoopLayer, MeshBasicMaterial>,
    [],
  );

  const sideLamps = useMemo(() => lampRing(SIDE_LAMPS, SIDE_RADIUS, 0.61, [0.2, 0.22, 0.06]), []);
  const eqRing = useMemo(() => lampRing(EQ_BARS, EQ_RADIUS, HUB_SHOULDER_Y + 0.02, [0.1, 1, 0.16], 1), []);
  const meters = useMemo(
    () => Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, meterColumn(METER_AT.x, METER_AT.z, SLOT_TOP + 0.02, METER_STEP)])) as Record<LoopLayer, ReturnType<typeof meterColumn>>,
    [],
  );
  const particles = useMemo(() => new DeckParticles(PERFORMANCE.tier === 'low' ? 160 : 420), []);
  useEffect(() => () => {
    particles.dispose();
    for (const mesh of [sideLamps, eqRing, ...Object.values(meters)]) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    for (const material of [...Object.values(shaftMaterials), ...Object.values(waveMaterials)]) material.dispose();
  }, [particles, sideLamps, eqRing, meters, shaftMaterials, waveMaterials]);

  const colors = useMemo(() => ({
    accent: new Color(look.accent),
    secondary: new Color(look.secondary),
    white: new Color('#ffffff'),
    overtime: new Color(OVERTIME_COLOR),
    dead: new Color(DEAD),
    due: new Color(DUE),
    scratch: new Color(),
    layers: Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, new Color(LAYER_COLORS[layer])])) as Record<LoopLayer, Color>,
    sparks: new Color('#ffd9a0'),
  }), [look.accent, look.secondary]);

  const fx = useRef<Record<LoopLayer, SlotFx>>(Object.fromEntries(LOOP_LAYERS.map((layer) => [layer, {
    startedAt: 0, waveAt: -Infinity, rippleAt: -Infinity, arm: 0, lift: 1, owed: 0, shaft: 0,
  }])) as Record<LoopLayer, SlotFx>);

  const me = state.players[runtime.playerId];
  const heldBlock = me?.heldBlockId ? state.blocks[me.heldBlockId] : null;
  const segments = useMemo(() => Array.from({ length: SEGMENTS }, (_, index) => index), []);
  const replaying = state.phase === 'complete';
  const lobby = state.phase === 'lobby';
  const demoRecord = useLobbyStage((stage) => (stage.record?.status === 'deck' ? stage.record : null));
  const opening = useMemo(() => (lobby ? openingOnDeck(state.themeId, state.runSeed) : null), [lobby, state.themeId, state.runSeed]);
  const onPlatter = useMemo(() => {
    const map = new Map<LoopLayer, BlockState>();
    if (replaying) return map;
    if (lobby) {
      if (opening) map.set('DRUMS', opening);
      if (demoRecord) map.set('BASS', demoRecord);
      return map;
    }
    for (const block of Object.values(state.blocks)) {
      if (block.status === 'deck' && block.layer) map.set(block.layer, block);
    }
    return map;
  }, [state.blocks, replaying, lobby, opening, demoRecord]);

  const landingBurst = (layer: LoopLayer) => {
    const at = platterOffset(layer);
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * Math.PI * 2;
      const speed = 2.5 + Math.random() * 2.5;
      particles.emit({
        x: at.x + Math.sin(a) * 0.9, y: RECORD_Y + 0.1, z: at.z + Math.cos(a) * 0.9,
        vx: Math.sin(a) * speed, vy: 1.5 + Math.random() * 3, vz: Math.cos(a) * speed,
        color: i % 4 === 0 ? colors.white : colors.layers[layer], life: 0.7 + Math.random() * 0.4, size: 0.3, gravity: 6,
      });
    }
  };

  useFrame((three, delta) => {
    const state = runtime.getState();
    const song = state.song;
    const me = state.players[runtime.playerId];
    const heldBlock = me?.heldBlockId ? state.blocks[me.heldBlockId] : null;
    const now = runtime.now();
    const dt = Math.min(delta, 0.05);
    const time = three.clock.elapsedTime;
    const beat = beatInfo(state, now);
    const bar = barPosition(state.transportStartedAt, state.bpm, now);
    const overtime = isOvertime(state, now);
    const spent = showProgress(state, now);
    const power = stagePower(state, now);
    const energy = showEnergy(state, now);
    const intro = introProgress(state, now);
    const clock = replayClock(state, now);
    const audio = audioFrame(state, beat, time);
    const { materials, slots } = model;
    const { accent, secondary, white, dead, scratch } = colors;
    const drive = 0.25 + power * 0.75;

    if (needle.current) {
      if (clock) {
        if (clock.position >= 0) needle.current.rotation.y = (clock.position % 1) * Math.PI * 2;
      } else if (state.phase === 'playing' && state.transportStartedAt && now < state.transportStartedAt) {
        needle.current.rotation.y = (window01(intro, 0.3, 1) - 1) * Math.PI * 2;
      } else if (state.transportStartedAt) {
        needle.current.rotation.y = (bar % 1) * Math.PI * 2;
      }
    }

    if (deckLight.current) {
      deckLight.current.intensity = (PERFORMANCE.tier === 'low' ? 2.6 : 4.0) * (0.35 + power * 0.65) * (0.75 + audio.loudness * 0.9);
    }

    {
      const rim = materials.Rim;
      const urgency = overtime ? 1 : Math.max(0, spent - 0.82) / 0.18;
      rim.color.copy(accent).lerp(colors.overtime, urgency);
      rim.emissive.copy(rim.color);
      const throb = overtime ? 1.6 + Math.sin(now / 90) * 1.4 : 0;
      rim.emissiveIntensity = (0.5 + beat.stepPulse * 0.5 + throb) * (0.25 + power * 0.75);
    }
    materials.Spoke.emissiveIntensity = (0.35 + beat.pulse * 2.2 * (0.3 + energy)) * drive;
    materials.Glow.emissiveIntensity = (0.6 + audio.loudness * 2.5 + beat.pulse * 0.6) * drive;
    materials.Trim.emissiveIntensity = 0.15 + energy * 0.35;
    const cone = model.cone;
    const thump = audio.low * audio.low;
    cone.position.y = model.coneRestY + thump * 0.09;
    cone.scale.set(1 + thump * 0.04, 1 + thump * 0.25, 1 + thump * 0.04);

    const motion = decorativeMotion();
    model.crown.rotation.y += dt * (.3 + energy * .7) * motion;
    model.crown.position.y = DECK_TOP + 1.6 + Math.sin(time * 1.5) * .055 * motion;
    model.orbit.rotation.y -= dt * (.2 + energy * .45) * motion;
    model.orbit.rotation.z = Math.sin(time * .7) * .16 * motion;
    fadeAura(ejectHalo, focus.kind === 'eject' ? auraPulse(now) : 0, delta);
    const overtimeLeft = overtime
      ? showRemainingMs(state, now) / Math.max(1, (state.hardEndsAt ?? 0) - (state.showEndsAt ?? 0))
      : 0;
    const due = (Math.min(song.sectionIndex, SECTION_PLAN.length - 1) + 1) / SECTION_PLAN.length;
    const late = spent > due;
    const step = 1 / segments.length;
    const booting = state.phase === 'lobby' || (state.phase === 'playing' && intro < 1);
    const songProgress = clock && clock.songBars > 0
      ? Math.min(1, Math.max(0, clock.bar) / clock.songBars)
      : 0;
    for (let index = 0; index < segments.length; index += 1) {
      const material = dial.segments[index]!;
      const at = (index + 1) / segments.length;
      if (booting) {
        const litAt = 0.3 + 0.45 * (index / segments.length);
        const since = intro - litAt;
        if (since < 0) {
          material.color.copy(dead);
          material.opacity = 0.14;
        } else {
          material.color.copy(accent).lerp(white, Math.max(0, 1 - since / 0.08));
          material.opacity = 0.95;
        }
        continue;
      }
      if (clock) {
        const sectionIndex = Math.max(0, sectionAtBar(song.committed, (at - step / 2) * clock.songBars));
        const played = at - step < songProgress;
        const head = played && at >= songProgress;
        if (!played) material.color.copy(dead);
        else material.color.copy(head ? white : sectionIndex % 2 === 0 ? accent : secondary);
        material.opacity = head ? 1 : played ? 0.8 + beat.pulse * 0.2 : 0.16;
        continue;
      }
      if (!overtime && at >= due && at - step < due && !late) {
        material.color.copy(colors.due);
        material.opacity = 0.55 + beat.pulse * 0.45;
        continue;
      }
      if (!overtime && late && at > due - step && at - step < spent) {
        material.color.copy(colors.due);
        material.opacity = 0.35 + Math.abs(Math.sin(now / 160)) * 0.6;
        continue;
      }
      if (overtime) {
        const alive = at <= overtimeLeft;
        material.color.copy(colors.overtime);
        material.opacity = alive ? 0.7 + Math.abs(Math.sin(now / 120)) * 0.3 : 0.1;
      } else if (spent >= at) {
        material.color.copy(dead);
        material.opacity = 0.22;
      } else if (spent >= at - 1 / segments.length) {
        material.color.copy(white);
        material.opacity = 1;
      } else {
        material.color.copy(accent);
        material.opacity = 0.95;
      }
    }

    dial.flush();

    for (let i = 0; i < SIDE_LAMPS; i += 1) {
      const turn = i / SIDE_LAMPS;
      const fold = Math.abs(((turn * 2) % 1) - 0.5) * 2;
      const band = Math.min(audio.bands.length - 1, Math.floor(fold * audio.bands.length));
      const value = audio.bands[band]!;
      const chase = clock || booting ? 0 : Math.exp(-((((turn - beat.barPhase + 1.5) % 1) - 0.5) ** 2) / 0.0015);
      scratch.copy(accent).lerp(secondary, fold);
      const gain = booting && state.phase === 'lobby'
        ? 0.12 + Math.max(0, Math.sin(now / 900 + turn * Math.PI * 4)) * 0.25
        : (0.12 + value ** 1.5 * 2.4 + chase * 1.6) * drive;
      setLamp(sideLamps, i, SIDE_LAMPS, SIDE_RADIUS, 0.61, -1, scratch, gain);
    }
    sideLamps.instanceColor!.needsUpdate = true;

    for (let i = 0; i < EQ_BARS; i += 1) {
      const half = EQ_BARS / 2;
      const band = Math.min(audio.bands.length - 1, Math.floor(((i < half ? i : EQ_BARS - 1 - i) / half) * audio.bands.length));
      const value = audio.bands[band]! * drive;
      scratch.copy(accent).lerp(secondary, band / audio.bands.length);
      setLamp(eqRing, i, EQ_BARS, EQ_RADIUS, HUB_SHOULDER_Y + 0.02, 0.05 + value * 0.72, scratch, 0.5 + value * 2.2);
    }
    eqRing.instanceMatrix.needsUpdate = true;
    eqRing.instanceColor!.needsUpdate = true;

    for (const [order, layer] of LOOP_LAYERS.entries()) {
      const slot = slots[layer];
      const state_ = fx.current[layer];
      const root = slotRoots.current[layer];
      const riseAt = 0.42 + order * 0.07;
      const rise = state.phase === 'lobby' ? 0 : state.phase === 'playing' && intro < 1 ? window01(intro, riseAt, riseAt + 0.14) : 1;
      if (root) {
        const overshoot = rise > 0 && rise < 1 ? Math.sin(rise * Math.PI) * 0.12 : 0;
        root.position.y = -(1 - rise) * 0.22 + overshoot;
        root.scale.setScalar(finaleCut(state, now) ? 1.22 : 1);
      }
      const meter = meters[layer];
      const shaft = shafts.current[layer];
      const shaftUniforms = shaftMaterials[layer].uniforms;
      if (clock) {
        const moment = platterMoment(state, clock, layer);
        const colour = moment.current || moment.incoming ? colors.layers[layer] : dead;
        slot.collar.color.copy(colour);
        slot.collar.emissive.copy(colour);
        slot.collar.emissiveIntensity = (moment.current ? 1 + beat.pulse * 0.6 : 0.3) + moment.landing * 4 + moment.arriving * 1.2;
        slot.trim.emissiveIntensity = moment.current ? 0.4 + beat.pulse * 0.4 : 0.1;
        const glow = platterLights.current[layer];
        if (glow) {
          const target = moment.current ? 1.4 + moment.landing * 3 : 0;
          glow.intensity += (target - glow.intensity) * (1 - Math.exp(-delta * 8));
        }
        const fuse = countdowns.current[layer];
        if (fuse) fuse.visible = false;
        halos[layer].opacity = 0;
        halos[layer].visible = false;
        if (shaft) shaft.visible = false;
        for (let i = 0; i < METER_CELLS; i += 1) meter.setColorAt(i, scratch.copy(dead).multiplyScalar(0.3));
        meter.instanceColor!.needsUpdate = true;
        slot.platter.rotation.y += delta * 1.6;
        slot.arm.rotation.y = slot.armRest.y + ARM_PLAY_OUTER;
        continue;
      }
      if (rise < 1) {
        const flash = rise > 0 ? Math.sin(rise * Math.PI) : 0;
        slot.collar.color.copy(flash > 0 ? colors.layers[layer] : dead);
        slot.collar.emissive.copy(slot.collar.color);
        slot.collar.emissiveIntensity = 0.2 + flash * 3.5;
        slot.trim.emissiveIntensity = 0.1 + flash * 1.5;
        const lobbyRecord = state.phase === 'lobby' ? onPlatter.get(layer) ?? null : null;
        const group = records.current[layer];
        if (lobbyRecord && group) {
          const lands = lobbyRecord.id === DEMO_RECORD_ID ? useLobbyStage.getState().landsAt : -Infinity;
          const turning = now >= lands;
          const landedMs = now - lands;
          const landing = landedMs >= 0 && landedMs < LANDING_MS ? 1 - landedMs / LANDING_MS : 0;
          if (turning) {
            group.rotation.y += delta * 1.5;
            slot.platter.rotation.y += delta * 1.5;
          }
          group.scale.setScalar(RECORD_SCALE * (1 + (turning ? 0 : Math.sin(now / 140) * 0.012) + landing * 0.12));
          group.position.y = RECORD_Y + landing * landing * 0.14;
          slot.collar.color.copy(colors.layers[layer]);
          slot.collar.emissive.copy(slot.collar.color);
          slot.collar.emissiveIntensity = (turning ? 0.8 : 0.3) + landing * 4;
          if (Number.isFinite(lands) && landedMs >= 0 && landedMs < 400 && state_.startedAt !== lands) {
            state_.startedAt = lands;
            state_.waveAt = now;
            landingBurst(layer);
          }
        }
        if (shaft) shaft.visible = false;
        for (let i = 0; i < METER_CELLS; i += 1) meter.setColorAt(i, scratch.copy(colors.layers[layer]).multiplyScalar(0.06 + (flash > i / METER_CELLS ? 1.5 : 0)));
        meter.instanceColor!.needsUpdate = true;
        continue;
      }

      const group = records.current[layer];
      const record = onPlatter.get(layer) ?? null;
      const pending = song.queued.find((change) => change.layer === layer);
      const armed = !!record && pending?.blockId === record.id;
      const spinning = !!record && !armed && song.layers[layer].blockId === record.id;
      const sounding = song.layers[layer].sampleName !== null;
      const layerFx = song.layers[layer].fx;
      const carrying = heldBlock?.role === layer;
      const level = sounding ? audio.levels[layer] : 0;
      const startedAt = sounding ? barToTime(state.transportStartedAt, state.bpm, song.layers[layer].startedAtBar) : 0;
      const landedMs = sounding ? now - startedAt : Infinity;
      const landing = landedMs >= 0 && landedMs < LANDING_MS ? 1 - landedMs / LANDING_MS : 0;
      const at = platterOffset(layer);

      if (sounding && landedMs >= 0 && startedAt !== state_.startedAt) {
        state_.startedAt = startedAt;
        state_.waveAt = now;
        landingBurst(layer);
      }

      if (group) {
        if (spinning) group.rotation.y += delta * 1.5;
        const breathe = armed ? Math.sin(now / 140) * 0.012 : 0;
        group.scale.setScalar(RECORD_SCALE * (1 + (spinning ? beat.pulse * 0.04 + level * 0.03 : 0) + breathe + landing * 0.12));
        group.position.y = RECORD_Y + landing * landing * 0.14;
      }
      if (spinning || (sounding && !record)) slot.platter.rotation.y += delta * 1.5;

      const phrase = sounding ? (((bar - song.layers[layer].startedAtBar) % (PHRASE_BARS * 2)) + PHRASE_BARS * 2) % (PHRASE_BARS * 2) / (PHRASE_BARS * 2) : 0;
      const armTarget = spinning ? MathUtils.lerp(ARM_PLAY_OUTER, ARM_PLAY_INNER, phrase) : 0;
      state_.arm += (armTarget - state_.arm) * Math.min(1, dt * 5);
      const moving = Math.abs(armTarget - state_.arm) > 0.02 || !spinning;
      state_.lift += ((moving ? 1 : 0) - state_.lift) * Math.min(1, dt * 8);
      slot.arm.rotation.y = slot.armRest.y + state_.arm;
      slot.arm.rotation.x = slot.armRest.x - state_.lift * 0.1;

      {
        const colour = sounding || carrying || pending || record ? colors.layers[layer] : dead;
        slot.collar.color.copy(colour);
        slot.collar.emissive.copy(colour);
        let intensity = spinning ? 0.9 + level * 1.6 : sounding ? 0.7 : 0.25;
        if (pending) {
          const barsAway = Math.max(0, pending.atBar - bar);
          const urgency = 1 - Math.min(1, barsAway / 2);
          intensity = 0.8 + (0.5 + 0.5 * Math.sin(now / (60 - urgency * 35))) * (1 + urgency * 2);
        } else if (carrying) {
          intensity = 0.9 + beat.pulse * 0.9;
        }
        if (spinning && layerFx.crush) intensity *= 0.7 + Math.random() * 0.7;
        if (spinning && layerFx.filter) intensity *= 0.55;
        slot.collar.emissiveIntensity = intensity + landing * 4;
        slot.trim.emissiveIntensity = 0.12 + (sounding ? 0.2 + level * 0.9 : 0) + (carrying ? beat.pulse * 0.5 : 0) + landing * 1.5;
      }

      {
        const lit = level * METER_CELLS;
        for (let i = 0; i < METER_CELLS; i += 1) {
          const on = MathUtils.clamp(lit - i, 0, 1);
          scratch.copy(i >= METER_CELLS - 2 ? white : colors.layers[layer]);
          meter.setColorAt(i, scratch.multiplyScalar(0.05 + on * (i >= METER_CELLS - 2 ? 2.2 : 1.7)));
        }
        meter.instanceColor!.needsUpdate = true;
      }

      if (shaft) {
        const want = spinning ? (0.25 + level * 0.75) * (layerFx.filter ? 0.35 : 1) : 0;
        state_.shaft += (want - state_.shaft) * Math.min(1, dt * 6);
        shaft.visible = state_.shaft > 0.01;
        shaftUniforms.uIntensity!.value = state_.shaft * (0.35 + beat.pulse * 0.25) * (0.6 + energy * 0.6) + landing * 0.8;
        shaft.rotation.z = Math.sin(time * 0.6 + order * 1.7) * 0.05;
        shaft.rotation.x = Math.cos(time * 0.5 + order * 2.3) * 0.05;
      }

      if (spinning) {
        const rate = (6 + level * 26) * (layerFx.filter ? 0.35 : 1) * (PERFORMANCE.tier === 'low' ? 0.4 : 1);
        state_.owed += rate * dt;
        while (state_.owed >= 1) {
          state_.owed -= 1;
          const a = Math.random() * Math.PI * 2;
          const r = 0.4 + Math.random() * 0.5;
          const x = at.x + Math.sin(a) * r;
          const z = at.z + Math.cos(a) * r;
          if (layerFx.crush) {
            particles.emit({
              x, y: RECORD_Y + 0.1, z,
              vx: Math.sin(a) * 2.2, vy: 3 + Math.random() * 3, vz: Math.cos(a) * 2.2,
              color: Math.random() < 0.5 ? colors.sparks : colors.layers[layer], life: 0.45 + Math.random() * 0.3, size: 0.22, gravity: 9,
            });
          } else if (layerFx.reverb) {
            particles.emit({
              x, y: RECORD_Y + 0.1, z,
              vx: Math.sin(a) * 0.25, vy: 0.7 + Math.random() * 0.6, vz: Math.cos(a) * 0.25,
              color: colors.layers[layer], life: 2.4 + Math.random() * 1.2, size: 0.55, swirl: 0.5,
            });
          } else {
            particles.emit({
              x, y: RECORD_Y + 0.1, z,
              vx: Math.sin(a) * 0.4, vy: 1.4 + Math.random() * 1.4 + level * 1.5, vz: Math.cos(a) * 0.4,
              color: Math.random() < 0.2 ? white : colors.layers[layer], life: 1.1 + Math.random() * 0.6,
              size: layerFx.filter ? 0.26 : 0.36, swirl: 0.3,
            });
          }
        }
        if (layerFx.reverb && beat.beatPhase < 0.2 && now - state_.rippleAt > 300) state_.rippleAt = now;
      }

      const wave = waves.current[layer];
      if (wave) {
        const landingT = (now - state_.waveAt) / WAVE_MS;
        const rippleT = (now - state_.rippleAt) / (WAVE_MS * 1.3);
        if (landingT < 1) {
          wave.visible = true;
          wave.scale.setScalar(1.2 + landingT * 3.4);
          waveMaterials[layer].opacity = (1 - landingT) ** 1.4;
        } else if (rippleT < 1) {
          wave.visible = true;
          wave.scale.setScalar(1.3 + rippleT * 1.6);
          waveMaterials[layer].opacity = (1 - rippleT) ** 2 * 0.45;
        } else {
          wave.visible = false;
        }
      }

      const countdown = countdowns.current[layer];
      if (countdown) {
        countdown.visible = armed;
        if (armed && pending) {
          const uniforms = countdownMaterials[layer].uniforms;
          uniforms.uProgress!.value = Math.min(1, Math.max(0, 1 - (pending.atBar - bar) / (PHRASE_BARS + 0.35)));
          uniforms.uOpacity!.value = 0.75 + beat.stepPulse * 0.25;
        }
      }
      const placing = focus.kind === 'place' && focus.layer === layer;
      fadeAura(halos[layer], placing ? auraPulse(now) : 0, delta);
      const light = platterLights.current[layer];
      if (light) {
        const target = spinning ? 1.2 + level * 1.4 + landing * 3 : armed ? 0.7 : 0;
        light.intensity += (target - light.intensity) * (1 - Math.exp(-delta * 8));
      }
    }

    const material = particles.points.material as ShaderMaterial;
    material.uniforms.uScale!.value = viewport.height / (2 * Math.tan(MathUtils.degToRad(camera.fov / 2)));
    particles.update(dt, time);
  });

  return (
    <group position={[DECK_POSITION.x, DECK_POSITION.y, DECK_POSITION.z]}>
      <primitive object={model.base} />
      <primitive object={sideLamps} />

      <group position={[0, CLOCK_Y, 0]}>
        <primitive object={dial.mesh} />
        <mesh geometry={quarterMarks} material={quarterMaterial} />
      </group>

      {LOOP_LAYERS.map((layer) => {
        const position = platterOffset(layer);
        const block = onPlatter.get(layer) ?? null;
        const entry = block ? gameSample(block.sampleName) : null;
        const armed = !!block && song.queued.some((change) => change.layer === layer && change.blockId === block.id);
        return (
          <group key={layer} position={[position.x, 0, position.z]} rotation={[0, platterAngle(layer), 0]}>
            <group ref={(node) => { if (node) slotRoots.current[layer] = node; }}>
              <primitive object={model.slots[layer].root} />
              <primitive object={meters[layer]} />
              <group ref={(node) => { if (node) records.current[layer] = node; }} position={[0, RECORD_Y, 0]} scale={RECORD_SCALE}>
                {block && (
                  <RecordPlace id={block.id}>
                    <Vinyl role={layer} sampleName={block.sampleName} family={entry?.family} fx={block.fx} glow={armed ? 0.8 : 0.35} highlight={focus.kind === 'eject' && focus.layer === layer} />
                  </RecordPlace>
                )}
              </group>
              {replaying && (
                <group position={[0, RECORD_Y - 0.2, 0]}>
                  <ReplayPlatter layer={layer} />
                </group>
              )}
            </group>
            <mesh
              ref={(node) => { if (node) countdowns.current[layer] = node; }}
              position={[0, SLOT_TOP + 0.04, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={3}
              visible={false}
              material={countdownMaterials[layer]}
            >
              <ringGeometry args={[1.34, 1.48, 56]} />
            </mesh>
            <mesh position={[0, SLOT_TOP + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} material={halos[layer]}>
              <ringGeometry args={[1.56, 1.86, 48]} />
            </mesh>
            {focus.kind === 'eject' && focus.layer === layer && (
              <mesh position={[0, SLOT_TOP + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} material={ejectHalo}>
                <ringGeometry args={[1.56, 1.86, 48]} />
              </mesh>
            )}
            <mesh
              ref={(node) => { if (node) waves.current[layer] = node; }}
              geometry={waveGeometry}
              material={waveMaterials[layer]}
              position={[0, DECK_TOP + 0.04, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={4}
              visible={false}
            />
            {PERFORMANCE.tier !== 'low' && (
              <mesh
                ref={(node) => { if (node) shafts.current[layer] = node; }}
                geometry={shaftGeometry}
                material={shaftMaterials[layer]}
                position={[0, RECORD_Y, 0]}
                renderOrder={6}
                visible={false}
              />
            )}
            {PERFORMANCE.tier !== 'low' && (
              <pointLight
                ref={(node) => { if (node) platterLights.current[layer] = node; }}
                color={LAYER_COLORS[layer]}
                intensity={0}
                distance={4.6}
                decay={2}
                position={[0, RECORD_Y + 1, 0]}
              />
            )}
          </group>
        );
      })}

      <primitive object={model.hub} />
      <primitive object={eqRing} />

      <group ref={needle} position={[0, DECK_TOP + 0.04, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <ringGeometry args={[HUB_RADIUS + 0.1, DECK_RING_RADIUS - 0.04, 2, 1, -Math.PI / 2 - 0.035, 0.07]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.06, DECK_RING_RADIUS - 0.33]}>
          <boxGeometry args={[0.2, 0.12, 0.62]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        {PERFORMANCE.tier !== 'low' && (
          <pointLight color="#ffffff" intensity={1.4} distance={4} decay={2} position={[0, 0.35, DECK_RING_RADIUS - 0.35]} />
        )}
      </group>

      <primitive object={particles.points} />

      <pointLight ref={deckLight} color={look.accent} intensity={PERFORMANCE.tier === 'low' ? 2.6 : 4.0} distance={16} decay={2} position={[0, 3.6, 0]} />
    </group>
  );
}

const wedgeCache = new Map<string, RingGeometry>();
function wedge(index: number, count: number) {
  const key = `${index}/${count}`;
  let geometry = wedgeCache.get(key);
  if (!geometry) {
    const span = (Math.PI * 2) / count;
    const gap = Math.min(span * 0.12, 0.05);
    const start = Math.PI / 2 - (index + 1) * span + gap / 2;
    geometry = new RingGeometry(RING_INNER_R, DECK_RING_RADIUS - 0.05, Math.max(3, Math.ceil(40 / count)), 1, start, span - gap);
    wedgeCache.set(key, geometry);
  }
  return geometry;
}
const RING_INNER_R = 5.4;

function clockRing(count: number) {
  const parts = Array.from({ length: count }, (_, index) => wedge(index, count).toNonIndexed());
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  const ranges = parts.map((part) => part.getAttribute('position').count);
  const rgba = new Float32Array(geometry.getAttribute('position').count * 4);
  const colors = new BufferAttribute(rgba, 4).setUsage(DynamicDrawUsage);
  geometry.setAttribute('color', colors);
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  const segments = Array.from({ length: count }, () => ({ color: new Color(DEAD), opacity: 0.26 }));
  return {
    mesh,
    segments,
    flush() {
      let vertex = 0;
      segments.forEach((segment, index) => {
        for (let i = 0; i < ranges[index]!; i += 1, vertex += 1) {
          rgba[vertex * 4] = segment.color.r;
          rgba[vertex * 4 + 1] = segment.color.g;
          rgba[vertex * 4 + 2] = segment.color.b;
          rgba[vertex * 4 + 3] = segment.opacity;
        }
      });
      colors.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function countdownMaterial(color: string) {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uProgress: { value: 0 }, uOpacity: { value: 0.8 } },
    vertexShader: `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uProgress;
      uniform float uOpacity;
      varying vec2 vPos;
      void main() {
        float turn = fract(atan(vPos.x, vPos.y) / 6.28318530718 + 1.0);
        if (turn > uProgress) discard;
        float head = smoothstep(uProgress - 0.18, uProgress, turn);
        gl_FragColor = vec4(uColor * (1.4 + head * 2.2), uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    forceSinglePass: true,
    blending: AdditiveBlending,
  });
}
