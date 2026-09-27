import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { AnimationClip, Euler, Object3D, Quaternion, Vector3, type Group, type Mesh, type MeshBasicMaterial, type ShaderMaterial } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PLAYER_COLORS, isOvertime, replayClock, songArcNearestPoint, type FxSet, type GameState, type Gesture, type SampleRole } from '@loop/shared';
import { applyToonStyle } from '../toon';
import { PERFORMANCE } from '../performance';
import { danceSeconds, runStrideSpan, showEnergy, visualEpoch } from '../beat';
import { emitFootfall } from '../footfalls';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { Vinyl } from './Vinyl';
import { SoftDisc } from './SoftDisc';
import { holdBack, recordPose } from './Handoff';
import { DEV_HANDLE } from '../../runtime/devFlag';
import { reachTarget } from '../reachTarget';
import { AnimLayer, type BeatCycle } from './animLayer';
import { PERFORMER_STYLE_CLIPS, danceAt, danceBand, performerDances } from '../danceStyle';

export const RIG_FILES = ['Bald', 'Blond', 'Cyan', 'Green', 'Grey', 'Pink', 'Purple']
  .map((variant) => `/characters/Rabbit_${variant}.glb`);

export const MOVES_FILE = '/characters/rabbit_anims.glb';

const PERFORMER_SHADOW = 0.22;
const SHADOW_FADE_HEIGHT = 1.2;

const CLIP = {
  stand: 'Idle',
  sprint: 'Run',
  sprintHot: 'Run_Hype',
  standCradle: 'Idle_Holding',
  sprintCradle: 'Run_Holding',
  greet: 'Wave',
  aim: 'Lob_Aim',
  printStart: 'Print_Start',
  printCharge: 'Print_Charge',
  printSlam: 'Print_Slam',
  printCancel: 'Print_Cancel',
  danceCradle: 'Dance_Nod_Holding',
  danceCradleHot: 'Dance_Groove_Holding',
  celebrate: 'Celebrate',
  celebrateArms: 'Celebrate_Upper',
  sulk: 'Disappointed',
  victory: 'Victory',
} as const;

const GESTURE_CLIP: Record<Exclude<Gesture, 'lever'>, string> = {
  grab: 'Grab',
  'grab-high': 'Grab_High',
  catch: 'Catch',
  place: 'Place',
  feed: 'Feed',
  lob: 'Lob_Release',
  drop: 'Drop',
  eject: 'Eject',
};
const WHOLE_BODY_GESTURES = new Set<Gesture>(['grab', 'catch', 'drop']);

const GRAB_CONTACT_FRAMES: Partial<Record<Gesture, number>> = { grab: 4, 'grab-high': 5, catch: 4 };
const RELEASE_FRAMES: Partial<Record<Gesture, number>> = { place: 4, feed: 4, drop: 4 };
function handoffMs(distance: number, least: number) {
  return Math.min(HANDOFF_MAX_MS, Math.max(least, least + distance * HANDOFF_MS_PER_UNIT));
}
const HANDOFF_MS_PER_UNIT = 38;
const HANDOFF_MAX_MS = 300;
const RELEASE_FLIGHT_MS = 150;
function handoffArc(distance: number) {
  return Math.min(0.45, 0.1 + distance * 0.07);
}
const HANDOFF_SPIN = Math.PI * 0.55;

const DEMO_CHARGE_MS = 650;
const LEVER_GRACE_MS = 260;
const PRINT_SLAM_AT = 0.86;
const PRINT_PLANT = { contact: 3, lift: 9 } as const;
const PRINT_TOP_IN = 0.68;
const PRINT_TOP_Y = 1.26;
const PRINT_FIST_SPREAD = 0.22;

const DANCE_HOLD_MS = 2400;
const DANCE_FADE = 0.32;
const RUN_FADE = 0.18;
const LOOP_FADE = 0.24;
const ONE_SHOT_FADE = 0.08;

const CHEER_SCORE = 650;
const SULK_SCORE = 400;

export const DRACO_DECODER = '/draco/';
useGLTF.setDecoderPath(DRACO_DECODER);

const RIG_SCALE = 0.56;
const RIG_FOOT_OFFSET = -0.73;

const UPPER_BODY = /^(Abdomen|Torso|Neck|Head|Shoulder|UpperArm|LowerArm|Hand|Pinky|Middle|Index|Thumb)/;
const LOWER_BODY = /^(Hips|Body|Root|UpperLeg|LowerLeg|Foot|PoleTarget)/;

const LOWER_SUFFIX = '__lower';
const UPPER_SUFFIX = '__upper';

const upperNames = new Map<string, string>();
const lowerNames = new Map<string, string>();
function upperOf(clip: string) {
  let name = upperNames.get(clip);
  if (name === undefined) upperNames.set(clip, (name = clip + UPPER_SUFFIX));
  return name;
}
function lowerOf(clip: string) {
  let name = lowerNames.get(clip);
  if (name === undefined) lowerNames.set(clip, (name = clip + LOWER_SUFFIX));
  return name;
}

const HAND_BONES = ['Middle1L', 'Middle1R'];

const GRIP_SPREAD = 0.5;
const CARRY_POSES = new Set([CLIP.standCradle, CLIP.sprintCradle, CLIP.danceCradle, CLIP.danceCradleHot].map((name) => `${name}__upper`));

type Props = ThreeElements['group'] & {
  playerId: string;
  color: string;
  heldSample?: SampleRole | null;
  heldFamily?: string;
  heldSampleName?: string | null;
  heldFx?: FxSet;
  heldBlockId?: string | null;
  moving?: boolean;
  useUntil?: number;
  gesture?: Gesture | null;
  gestureAt?: number;
  printAt?: number;
  now: number;
  motion?: { current: PerformerMotion };
};

export type PerformerMotion = { moving: boolean; wave: number; cheer?: number; aiming?: boolean };

export function PerformerRig(props: Props) {
  return <Rig key={rigForPlayer(props.playerId, props.color)} {...props} />;
}

function Rig({
  playerId,
  color,
  heldSample,
  heldFamily,
  heldSampleName = null,
  heldFx,
  heldBlockId = null,
  moving: movingProp = false,
  useUntil = 0,
  gesture = null,
  gestureAt = 0,
  printAt = 0,
  now,
  motion,
  ...props
}: Props) {
  const runtime = useGameRuntime();
  const rigFile = rigForPlayer(playerId, color);
  const { scene, animations } = useGLTF(rigFile, DRACO_DECODER) as { scene: Group; animations: AnimationClip[] };
  const { animations: moves } = useGLTF(MOVES_FILE, DRACO_DECODER) as unknown as { animations: AnimationClip[] };

  const clips = useMemo(() => layeredClips(animations, moves), [animations, moves]);

  const cloned = useMemo(() => applyToonStyle(clone(scene), PERFORMANCE.shadows), [scene]);

  const hands = useMemo(
    () => HAND_BONES.map((name) => cloned.getObjectByName(name) ?? null).filter(Boolean) as Object3D[],
    [cloned],
  );
  const arms = useMemo(
    () => ['UpperArmL', 'UpperArmR'].map((name) => cloned.getObjectByName(name) ?? null).filter(Boolean) as Object3D[],
    [cloned],
  );
  const grip = useRef(0);
  const gripTurns = useMemo(() => [0, 1].map(() => ({ base: new Quaternion(), written: new Quaternion(), applied: false })), []);
  const spine = useMemo(
    () => TWIST_SHARES.map(([name, share, nodShare, leanShare]) => ({
      bone: cloned.getObjectByName(name) ?? null, share, nod: nodShare, lean: leanShare,
      base: new Quaternion(), written: new Quaternion(), applied: false,
    })),
    [cloned],
  );
  const drive = useRef(0);
  const hips = useMemo(() => cloned.getObjectByName('Hips') ?? null, [cloned]);
  const bounce = useRef({ primed: false, y: 0, v: 0, a: 0, s: 0, weight: 0 });
  const feet = useMemo(() => ['FootL', 'FootR'].map((name) => cloned.getObjectByName(name) ?? null), [cloned]);
  const run = useRef({
    weight: 0,
    drive: 0,
    hot: false,
    hype: 0,
    step: null as number | null,
    cycle: { span: RUN_FREE_SPAN, phase: RUN_RIGHT_FOOT } as BeatCycle,
    hotCycle: { span: RUN_FREE_SPAN, phase: 0 } as BeatCycle,
  });
  const reach = useRef({ kind: null as Gesture | null, start: 0, until: 0, ok: false, target: new Vector3() });

  const animationRoot = useRef<Group>(null);
  const { actions } = useAnimations(clips, animationRoot);
  const lowerBody = useMemo(() => new AnimLayer(), []);
  const upperBody = useMemo(() => new AnimLayer(), []);
  const oneShotEndsAt = useRef(0);
  const legsBusyUntil = useRef(0);
  const followUp = useRef<string | null>(null);
  const carried = useRef<Group>(null);
  const root = useRef<Group>(null);
  const ground = useRef<Group>(null);
  const wave = useRef<Mesh>(null);
  const impactAt = useRef(0);

  const carrying = !!heldSample;
  const anchor = anchorFor(rigFile);
  const attachedAt = useRef(-Infinity);
  const settleMs = useRef(PICKUP_FADE * 1000);
  const takenFrom = useRef<LocalPose | null>(null);
  const flightArc = useRef(0.2);
  const arrivedAt = useRef(-Infinity);
  const sway = useRef({ primed: false, at: new Vector3(), velocity: new Vector3(), accel: new Vector3(), pitch: 0, roll: 0, pitchV: 0, rollV: 0 });
  const handoffFrom = useMemo(() => ({ position: new Vector3(), quaternion: new Quaternion(), scale: 1 }), []);
  const handoffTo = useMemo(() => ({ position: new Vector3(), quaternion: new Quaternion(), scale: 1 }), []);

  const lastUse = useRef(useUntil);
  useEffect(() => {
    const repeat = Math.abs(useUntil - lastUse.current) < 450;
    lastUse.current = useUntil;
    if (useUntil <= now || repeat) return;
    impactAt.current = performance.now();
  }, [useUntil]);

  const heldKey = heldSample ? heldSampleName ?? heldSample : null;

  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const inHands = useRef<CarriedRecord | null>(null);
  const letGo = useRef<LetGo | null>(null);
  if (heldSample) {
    inHands.current = { id: heldBlockId, role: heldSample, family: heldFamily, sampleName: heldSampleName, fx: heldFx };
    letGo.current = null;
  } else if (inHands.current) {
    const released = inHands.current;
    inHands.current = null;
    const frames = gesture ? RELEASE_FRAMES[gesture] : undefined;
    if (frames && released.id && runtime.now() - gestureAt < 1000) {
      const opensAt = performance.now() + (frames / 30) * 1000;
      const state = runtime.getState();
      const to = state.blocks[released.id]?.position;
      const from = state.players[playerId]?.position;
      const distance = to && from ? Math.hypot(to.x - from.x, to.z - from.z) : 0;
      const flightMs = handoffMs(distance, RELEASE_FLIGHT_MS);
      letGo.current = { record: released, opensAt, from: null, flightMs, arc: handoffArc(distance) };
      holdBack(released.id, opensAt + flightMs);
    }
  }
  const shown = heldSample ? inHands.current : letGo.current?.record ?? null;
  const frameHeld = useRef<string | null>(null);
  const waved = useRef(motion?.current.wave ?? 0);
  const cheered = useRef(motion?.current.cheer ?? 0);
  const acted = useRef({ kind: gesture, at: gestureAt });
  const leverSeenAt = useRef(-Infinity);
  const print = useRef({ holding: false, slamAt: -Infinity, reaction: null as null | { clip: string; running: string }, demoSlamAt: 0 });
  const demoPrinted = useRef(printAt);
  const reachBones = useMemo(
    () => ['UpperArmL', 'LowerArmL', 'UpperArmR', 'LowerArmR'].map((name) => ({ bone: cloned.getObjectByName(name) ?? null, base: new Quaternion(), written: new Quaternion(), applied: false })),
    [cloned],
  );
  const lastEvent = useRef(runtime.getState().lastEvent?.id ?? null);
  const groove = useRef<{ name: string; since: number; band: number; beat: number } | null>(null);
  const idlePhase = useMemo(() => idlePhaseFor(playerId), [playerId]);

  useFrame((_, delta) => {
    const moving = motion ? motion.current.moving : movingProp;
    const clock = performance.now();
    const state = runtime.getState();
    const t = runtime.now();
    if (DEV_HANDLE) {
      const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop;
      if (handle) {
        ((handle.pose ??= {}) as Record<string, string>)[playerId] = upperBody.name;
        ((handle.legs ??= {}) as Record<string, string>)[playerId] = lowerBody.name;
      }
    }
    const standing = !moving;

    const seconds = clock / 1000;
    const shot = (layer: AnimLayer, endsAt: { current: number }, name: string) => {
      const action = actions[name];
      if (layer.once(action, ONE_SHOT_FADE, seconds)) endsAt.current = clock + action!.getClip().duration * 1000;
    };
    const armShot = (clip: string) => {
      followUp.current = null;
      shot(upperBody, oneShotEndsAt, upperOf(clip));
    };
    const bodyShot = (clip: string, runningClip = clip) => {
      if (moving) return armShot(runningClip);
      armShot(clip);
      shot(lowerBody, legsBusyUntil, lowerOf(clip));
    };

    if (motion && motion.current.wave !== waved.current) {
      waved.current = motion.current.wave;
      if (!carrying) armShot(CLIP.greet);
    }
    if (motion && (motion.current.cheer ?? 0) !== cheered.current) {
      cheered.current = motion.current.cheer ?? 0;
      if (!carrying) bodyShot(CLIP.victory, CLIP.celebrateArms);
    }

    if (gesture && gestureAt !== acted.current.at) {
      const repeat = gesture === acted.current.kind && Math.abs(gestureAt - acted.current.at) < 450;
      acted.current = { kind: gesture, at: gestureAt };
      if (gesture === 'lever') leverSeenAt.current = clock;
      else if (!repeat && t - gestureAt < 1000) {
        if (WHOLE_BODY_GESTURES.has(gesture)) bodyShot(GESTURE_CLIP[gesture]);
        else armShot(GESTURE_CLIP[gesture]);
        if (gesture !== 'lob') {
          reach.current.kind = gesture;
          reach.current.start = clock;
          reach.current.ok = false;
        }
        const contact = GRAB_CONTACT_FRAMES[gesture];
        if (contact) settleMs.current = (contact / 30) * 1000;
      }
    }

    const printing = print.current;
    const slam = () => {
      printing.holding = false;
      printing.slamAt = clock;
      bodyShot(CLIP.printSlam);
    };

    if (printAt !== demoPrinted.current) {
      demoPrinted.current = printAt;
      if (t - printAt < 1000 && !carrying) {
        bodyShot(CLIP.printStart);
        followUp.current = CLIP.printCharge;
        printing.demoSlamAt = clock + DEMO_CHARGE_MS;
      }
    }
    if (printing.demoSlamAt && clock >= printing.demoSlamAt) {
      printing.demoSlamAt = 0;
      slam();
      printing.reaction = { clip: CLIP.celebrate, running: CLIP.celebrateArms };
    }

    const event = state.lastEvent;
    if (event && event.id !== lastEvent.current) {
      lastEvent.current = event.id;
      if (event.type === 'section-printed' && !carrying && t - event.at < 1500) {
        const reaction = event.score >= CHEER_SCORE ? { clip: CLIP.celebrate, running: CLIP.celebrateArms }
          : event.score < SULK_SCORE ? { clip: CLIP.sulk, running: CLIP.sulk } : null;
        if (event.playerId === playerId) {
          if (clock - printing.slamAt > 1500) slam();
          printing.reaction = reaction;
        } else if (reaction) {
          bodyShot(reaction.clip, reaction.running);
        }
      }
    }
    if (printing.reaction && clock >= oneShotEndsAt.current) {
      bodyShot(printing.reaction.clip, printing.reaction.running);
      printing.reaction = null;
    }

    const since = (clock - impactAt.current) / IMPACT_MS;
    if (animationRoot.current) {
      animationRoot.current.position.z = since < 1 ? Math.sin(since * Math.PI) * 0.18 : 0;
    }
    if (wave.current) {
      const visible = since >= 0 && since < 1;
      wave.current.visible = visible;
      if (visible) {
        wave.current.scale.setScalar(0.3 + since * 2.1);
        (wave.current.material as MeshBasicMaterial).opacity = (1 - since) ** 1.6 * 0.7;
      }
    }

    if (heldKey !== frameHeld.current) {
      frameHeld.current = heldKey;
      if (heldKey) {
        attachedAt.current = clock;
        arrivedAt.current = -Infinity;
        takenFrom.current = null;
        const reaching = !!acted.current.kind && acted.current.kind in GRAB_CONTACT_FRAMES && clock < oneShotEndsAt.current;
        if (!reaching) {
          oneShotEndsAt.current = 0;
          settleMs.current = PICKUP_FADE * 1000;
        } else if (heldBlockId && root.current) {
          const pose = recordPose(heldBlockId, clock);
          if (pose) {
            takenFrom.current = toCharacterSpace(root.current, pose, handoffFrom);
            const contactMs = settleMs.current;
            const distance = takenFrom.current.position.distanceTo(anchor);
            settleMs.current = handoffMs(distance, contactMs);
            flightArc.current = handoffArc(distance);
            const reach = upperBody.current;
            if (reach && settleMs.current > contactMs) {
              const scale = contactMs / settleMs.current;
              reach.setEffectiveTimeScale(scale);
              oneShotEndsAt.current = clock + (reach.getClip().duration / scale) * 1000;
              const legsTo = lowerBody.current;
              if (legsTo && lowerBody.name === upperBody.name.replace(UPPER_SUFFIX, LOWER_SUFFIX)) {
                legsTo.setEffectiveTimeScale(scale);
                legsBusyUntil.current = oneShotEndsAt.current;
              }
            }
          }
        }
      }
    }

    const grooveTime = danceSeconds(state, t);
    const epoch = visualEpoch(state);
    const beatClock = epoch !== null ? grooveTime : seconds;
    const runner = run.current;
    runner.cycle.span = runner.hotCycle.span = epoch !== null ? runStrideSpan(state.bpm) : RUN_FREE_SPAN;
    const energyNow = epoch !== null ? showEnergy(state, t) : 0;
    runner.hot = runner.hot ? energyNow >= RUN_HOT_OFF : energyNow >= RUN_HOT_ON;
    const sprintClip = runner.hot ? CLIP.sprintHot : CLIP.sprint;
    const sprintCycle = runner.hot ? runner.hotCycle : runner.cycle;
    const sprintFade = RUN_SPRINT_CLIPS.has(lowerBody.name) ? DANCE_FADE : RUN_FADE;
    const beatNow = Math.floor(grooveTime * 2);
    const band = danceBand(showEnergy(state, t), groove.current?.band ?? 0);
    const scripted = DEV_HANDLE ? scriptedDance(playerId, t) : null;
    const dance = standing ? (scripted?.clip ?? danceFor(state, t, band, playerId, grooveTime)) : null;
    if (!dance) groove.current = null;
    else if (!groove.current) groove.current = { name: dance, since: clock, band, beat: beatNow };
    else {
      groove.current.band = band;
      if (groove.current.name !== dance && (scripted || (clock - groove.current.since > DANCE_HOLD_MS && beatNow !== groove.current.beat))) {
        groove.current.name = dance;
        groove.current.since = clock;
      }
      groove.current.beat = beatNow;
    }
    const grooving = groove.current?.name ?? null;
    const groovingAction = grooving ? actions[lowerOf(grooving)] : null;
    const lag = scripted?.lagMs && groovingAction
      ? { span: groovingAction.getClip().duration, phase: -(grooveTime - danceSeconds(state, t - scripted.lagMs)) / groovingAction.getClip().duration }
      : undefined;
    const lobbyIdle = standing && state.phase === 'lobby' ? lobbyIdleFor(playerId) : null;

    if (clock >= legsBusyUntil.current) {
      if (moving) lowerBody.beat(actions[lowerOf(sprintClip)], sprintFade, seconds, sprintCycle);
      else if (print.current.holding) lowerBody.loop(actions[lowerOf(CLIP.printCharge)], LOOP_FADE, seconds);
      else if (grooving) lowerBody.beat(actions[lowerOf(grooving)], DANCE_FADE, seconds, lag);
      else lowerBody.held(actions[lowerOf(lobbyIdle ?? CLIP.stand)], LOOP_FADE, seconds, idlePhase);
    }

    const printHeld = !carrying && clock - leverSeenAt.current < LEVER_GRACE_MS;
    const slamming = clock - printing.slamAt < 1200;
    if (printHeld && !printing.holding && !slamming) {
      printing.holding = true;
      bodyShot(CLIP.printStart);
      followUp.current = CLIP.printCharge;
    } else if (printing.holding && printHeld && state.commitProgress >= PRINT_SLAM_AT) {
      slam();
    } else if (printing.holding && !printHeld) {
      printing.holding = false;
      bodyShot(CLIP.printCancel);
    }
    const printBusy = printing.holding || slamming;

    if (clock >= oneShotEndsAt.current) {
      const aiming = carrying && !!motion?.current.aiming;
      if (followUp.current) {
        upperBody.loop(actions[upperOf(followUp.current)], 0.1, seconds);
      } else if (aiming) {
        upperBody.loop(actions[upperOf(CLIP.aim)], 0.12, seconds);
      } else if (grooving) {
        const cradle = (groove.current?.band ?? 0) >= 2 ? CLIP.danceCradleHot : CLIP.danceCradle;
        upperBody.beat(actions[upperOf(carrying ? cradle : grooving)], DANCE_FADE, seconds, carrying ? undefined : lag);
      } else {
        const upperClip = carrying
          ? (moving ? CLIP.sprintCradle : CLIP.standCradle)
          : (moving ? sprintClip : lobbyIdle ?? CLIP.stand);
        const entering = carrying && !upperBody.name.includes('_Holding');
        const fade = entering ? PICKUP_FADE : LOOP_FADE;
        if (moving) upperBody.beat(actions[upperOf(upperClip)], fade, seconds, upperClip === CLIP.sprintHot ? runner.hotCycle : runner.cycle);
        else upperBody.held(actions[upperOf(upperClip)], fade, seconds, idlePhase);
      }
    }
    lowerBody.update(seconds, beatClock, t / 1000);
    upperBody.update(seconds, beatClock, t / 1000);

    const running = moving && RUN_SPRINT_CLIPS.has(lowerBody.name);
    runner.weight += ((running ? 1 : 0) - runner.weight) * (1 - Math.exp(-delta * 10));
    runner.hype += ((running && runner.hot ? 1 : 0) - runner.hype) * (1 - Math.exp(-delta * 6));
    runner.drive += (showEnergy(state, t) - runner.drive) * (1 - Math.exp(-delta * 2.5));
    const stride = beatClock / runner.cycle.span;
    const step = Math.floor(stride * 2);
    const stepPhase = stride * 2 - step;
    if (running && runner.weight > 0.6 && runner.step !== null && step !== runner.step && root.current) {
      const foot = feet[step % 2 === 0 ? 1 : 0] ?? null;
      root.current.getWorldQuaternion(turn);
      forward.set(0, 0, 1).applyQuaternion(turn);
      forward.y = 0;
      forward.normalize();
      root.current.getWorldScale(rootScale);
      floorAt.set(0, RIG_FLOOR_Y, 0);
      root.current.localToWorld(floorAt);
      if (foot) foot.getWorldPosition(scratch);
      else scratch.copy(floorAt);
      emitFootfall({
        x: scratch.x,
        y: floorAt.y,
        z: scratch.z,
        dirX: forward.x,
        dirZ: forward.z,
        energy: runner.drive,
        scale: rootScale.x,
      });
    }
    runner.step = running ? step : null;
    const runLive = runner.weight;
    const runDrive = RUN_BASE + (1 - RUN_BASE) * runner.drive;
    const landed = 1 - smooth(clamp01(stepPhase / 0.3));

    const inCarry = carrying && CARRY_POSES.has(upperBody.name);
    grip.current += ((inCarry ? 1 : 0) - grip.current) * (1 - Math.exp(-delta * 16));
    const gripping = grip.current > 0.001 && arms.length === 2 && !!animationRoot.current;
    if (gripping) {
      animationRoot.current!.getWorldQuaternion(turn);
      up.set(0, 1, 0).applyQuaternion(turn);
    }
    arms.forEach((arm, index) => {
      const own = gripTurns[index]!;
      if (own.applied && arm.quaternion.equals(own.written)) arm.quaternion.copy(own.base);
      own.applied = false;
      if (!gripping || !arm.parent) return;
      own.base.copy(arm.quaternion);
      arm.parent.getWorldQuaternion(parentTurn);
      turn.setFromAxisAngle(up, (index === 0 ? 1 : -1) * GRIP_SPREAD * grip.current);
      local.copy(parentTurn).invert().multiply(turn).multiply(parentTurn);
      arm.quaternion.premultiply(local);
      own.written.copy(arm.quaternion);
      own.applied = true;
    });

    const aim = reach.current;
    let twist = 0;
    if (aim.kind && root.current) {
      if (aim.start && clock >= oneShotEndsAt.current) aim.kind = null;
      else {
        aim.until = oneShotEndsAt.current;
        if (!aim.ok) {
          root.current.getWorldPosition(worldAt);
          const record = heldBlockId ?? letGo.current?.record.id ?? null;
          aim.ok = reachTarget(state, aim.kind, record, worldAt, aim.target);
        }
        if (aim.ok) {
          root.current.getWorldPosition(worldAt);
          root.current.getWorldQuaternion(turn);
          forward.set(0, 0, 1).applyQuaternion(turn);
          const facing = Math.atan2(forward.x, forward.z);
          const wanted = Math.atan2(aim.target.x - worldAt.x, aim.target.z - worldAt.z);
          const off = Math.atan2(Math.sin(wanted - facing), Math.cos(wanted - facing));
          const u = Math.min(1, (clock - aim.start) / Math.max(1, aim.until - aim.start));
          const envelope = smooth(Math.min(1, u / 0.25)) * (1 - smooth(Math.max(0, (u - 0.6) / 0.4)));
          twist = Math.max(-TWIST_MAX, Math.min(TWIST_MAX, off)) * envelope;
        }
      }
    }
    const wantDrive = grooving && standing && !printBusy ? Math.min(1, Math.max(0, (showEnergy(state, t) - 0.12) / 0.7)) : 0;
    drive.current += (wantDrive - drive.current) * (1 - Math.exp(-delta * 3));
    const beatPhase = (((grooveTime * 2) % 1) + 1) % 1;
    const hit = drive.current * Math.cos(Math.PI * beatPhase) ** 6;

    let squash = 0;
    const spring = bounce.current;
    spring.weight += ((standing && !printBusy ? 1 : 0) - spring.weight) * (1 - Math.exp(-delta * 8));
    if (hips && animationRoot.current) {
      const dt = Math.min(0.05, Math.max(1e-3, delta));
      hips.getWorldPosition(scratch);
      animationRoot.current.worldToLocal(scratch);
      const y = scratch.y * RIG_SCALE;
      if (spring.primed) {
        const v = (y - spring.y) / dt;
        spring.a += ((v - spring.v) / dt - spring.a) * (1 - Math.exp(-dt * 30));
        spring.v = v;
      }
      spring.y = y;
      spring.primed = true;
      const want = Math.max(-0.08, Math.min(0.12, STRETCH_PER_SPEED * spring.v)) - Math.min(0.12, SQUASH_PER_ACCEL * Math.max(0, spring.a));
      spring.s += (want - spring.s) * (1 - Math.exp(-dt * 30));
      const air = clamp01((stepPhase - 0.1) / 0.85);
      const flight = Math.sin(Math.PI * air);
      const hop = runLive * (RUN_HOP_BASE + RUN_HOP * runDrive) * flight * (1 - 0.45 * runner.hype);
      const runSquash = runLive * runDrive * (RUN_STRETCH * flight - RUN_SQUASH * landed);
      squash = spring.s * spring.weight - hit * BEAT_SQUASH + runSquash;
      const along = 1 + squash;
      const across = 1 / Math.sqrt(along);
      animationRoot.current.scale.set(RIG_SCALE * across, RIG_SCALE * along, RIG_SCALE * across);
      animationRoot.current.position.y = RIG_FOOT_OFFSET - hit * BEAT_DIP + hop;
    }
    if (DEV_HANDLE) {
      const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop;
      if (handle) {
        ((handle.twist ??= {}) as Record<string, number>)[playerId] = twist;
        ((handle.drive ??= {}) as Record<string, number>)[playerId] = drive.current;
        ((handle.squash ??= {}) as Record<string, number>)[playerId] = squash;
        ((handle.run ??= {}) as Record<string, unknown>)[playerId] = {
          at: t, hot: runner.hot, weight: runner.weight, drive: runner.drive, stride, span: runner.cycle.span, lift: animationRoot.current?.position.y ?? 0,
        };
      }
    }
    const nodding = hit > 1e-3;
    const lean = runLive * (RUN_LEAN_BASE + RUN_LEAN * runDrive) * (1 - 0.5 * runner.hype);
    const leaning = runLive > 1e-3;
    if ((twist !== 0 || nodding || leaning) && animationRoot.current) {
      animationRoot.current.getWorldQuaternion(turn);
      up.set(0, 1, 0).applyQuaternion(turn);
      side.set(1, 0, 0).applyQuaternion(turn);
    }
    for (const joint of spine) {
      const bone = joint.bone;
      if (!bone) continue;
      if (joint.applied && bone.quaternion.equals(joint.written)) bone.quaternion.copy(joint.base);
      joint.applied = false;
      if ((twist === 0 && !nodding && !leaning) || !bone.parent) continue;
      joint.base.copy(bone.quaternion);
      bone.parent.getWorldQuaternion(parentTurn);
      turn.setFromAxisAngle(up, twist * joint.share);
      if (nodding) turn.multiply(nod.setFromAxisAngle(side, hit * joint.nod));
      if (leaning) turn.multiply(nod.setFromAxisAngle(side, lean * joint.lean));
      local.copy(parentTurn).invert().multiply(turn).multiply(parentTurn);
      bone.quaternion.premultiply(local);
      bone.updateMatrixWorld(true);
      joint.written.copy(bone.quaternion);
      joint.applied = true;
    }

    const slamAction = upperBody.name === upperOf(CLIP.printSlam) ? upperBody.current : null;
    const slamFrame = slamAction ? slamAction.time * 30 : 0;
    const plant = slamAction
      ? smooth(clamp01(slamFrame - (PRINT_PLANT.contact - 1))) * (1 - smooth(clamp01((slamFrame - PRINT_PLANT.lift) / 3)))
      : 0;
    for (const joint of reachBones) {
      const bone = joint.bone;
      if (!bone) continue;
      if (joint.applied && bone.quaternion.equals(joint.written)) bone.quaternion.copy(joint.base);
      joint.applied = false;
    }
    if (plant > 0.001 && root.current && hands.length === 2 && reachBones.every((joint) => joint.bone)) {
      root.current.getWorldPosition(worldAt);
      const edge = songArcNearestPoint(worldAt);
      const radius = Math.hypot(edge.x, edge.z) || 1;
      root.current.getWorldQuaternion(turn);
      side.set(1, 0, 0).applyQuaternion(turn);
      for (let arm = 0; arm < 2; arm += 1) {
        const upper = reachBones[arm * 2]!;
        const fore = reachBones[arm * 2 + 1]!;
        upper.base.copy(upper.bone!.quaternion);
        fore.base.copy(fore.bone!.quaternion);
        target.set(edge.x * (1 - PRINT_TOP_IN / radius), PRINT_TOP_Y, edge.z * (1 - PRINT_TOP_IN / radius))
          .addScaledVector(side, (arm === 0 ? 1 : -1) * PRINT_FIST_SPREAD);
        reachFor(upper.bone!, fore.bone!, hands[arm]!, target, plant);
        upper.written.copy(upper.bone!.quaternion);
        fore.written.copy(fore.bone!.quaternion);
        upper.applied = fore.applied = true;
      }
    }
    if (DEV_HANDLE) {
      const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop;
      if (handle && plant > 0.001 && hands.length === 2) {
        const misses = hands.map((hand, arm) => {
          hand.getWorldPosition(scratch);
          root.current!.getWorldPosition(worldAt);
          const edge = songArcNearestPoint(worldAt);
          const radius = Math.hypot(edge.x, edge.z) || 1;
          target.set(edge.x * (1 - PRINT_TOP_IN / radius), PRINT_TOP_Y, edge.z * (1 - PRINT_TOP_IN / radius));
          root.current!.getWorldQuaternion(turn);
          target.addScaledVector(side.set(1, 0, 0).applyQuaternion(turn), (arm === 0 ? 1 : -1) * PRINT_FIST_SPREAD);
          const shoulder = reachBones[arm * 2]!.bone!.getWorldPosition(new Vector3());
          const elbow = reachBones[arm * 2 + 1]!.bone!.getWorldPosition(new Vector3());
          return { miss: +scratch.distanceTo(target).toFixed(3), reach: +(shoulder.distanceTo(elbow) + elbow.distanceTo(scratch)).toFixed(3), needs: +shoulder.distanceTo(target).toFixed(3), shoulderY: +shoulder.y.toFixed(2) };
        });
        ((handle.print ??= {}) as Record<string, unknown>)[playerId] = { plant: +plant.toFixed(2), misses, at: [+worldAt.x.toFixed(2), +worldAt.z.toFixed(2)] };
      }
    }

    const block = carried.current;
    if (block && root.current) {
      if (hands.length) {
        handPoint.set(0, 0, 0);
        for (const hand of hands) handPoint.add(hand.getWorldPosition(scratch));
        handPoint.multiplyScalar(1 / hands.length);
        root.current.worldToLocal(handPoint).add(CARRY_OFFSET);
      } else {
        handPoint.copy(anchor);
      }

      root.current.getWorldPosition(worldAt);
      const inertia = sway.current;
      const dt = Math.min(0.05, Math.max(1e-3, delta));
      if (inertia.primed) {
        velocity.subVectors(worldAt, inertia.at).divideScalar(dt);
        accel.subVectors(velocity, inertia.velocity).divideScalar(dt);
        inertia.velocity.copy(velocity);
        if (accel.lengthSq() > 400 * 400) accel.set(0, 0, 0);
        root.current.getWorldQuaternion(rootTurn);
        accel.applyQuaternion(rootTurn.invert());
        inertia.accel.lerp(accel, 1 - Math.exp(-dt * 25));
      }
      inertia.at.copy(worldAt);
      inertia.primed = true;
      const wantPitch = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, -inertia.accel.z * SWAY_GAIN));
      const wantRoll = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, inertia.accel.x * SWAY_GAIN));
      inertia.pitchV += (SWAY_STIFF * (wantPitch - inertia.pitch) - SWAY_DAMP * inertia.pitchV) * dt;
      inertia.rollV += (SWAY_STIFF * (wantRoll - inertia.roll) - SWAY_DAMP * inertia.rollV) * dt;
      inertia.pitch += inertia.pitchV * dt;
      inertia.roll += inertia.rollV * dt;

      const leaving = letGo.current;
      if (!heldSample && leaving) {
        if (clock < leaving.opensAt) {
          block.position.lerp(handPoint, 1 - Math.exp(-delta * 30));
        } else {
          leaving.from ??= { position: block.position.clone(), quaternion: block.quaternion.clone(), scale: block.scale.x };
          const u = Math.min(1, (clock - leaving.opensAt) / leaving.flightMs);
          const pose = leaving.record.id ? recordPose(leaving.record.id, clock) : null;
          if (!pose || u >= 1) {
            letGo.current = null;
            block.visible = false;
            redraw();
          } else {
            flyBetween(block, leaving.from, toCharacterSpace(root.current, pose, handoffTo), u, smooth(u), leaving.arc);
          }
        }
      } else if (heldSample) {
        block.visible = true;
        const since = clock - attachedAt.current;
        const holding = Math.min(1, Math.max(0, since / settleMs.current));
        const from = takenFrom.current;
        if (from && holding < 1) {
          handoffTo.position.copy(handPoint);
          handoffTo.quaternion.copy(CARRY_TURN);
          handoffTo.scale = 1;
          flyBetween(block, from, handoffTo, holding, 1 - (1 - holding) ** 2.2, flightArc.current);
          arrivedAt.current = clock + (1 - holding) * settleMs.current;
        } else {
          takenFrom.current = null;
          target.copy(anchor);
          target.lerp(handPoint, from ? 1 : holding ** 3);
          const resting = upperBody.name === upperOf(CLIP.standCradle);
          if (holding > 0.98 && !moving && resting && hands.length) anchor.lerp(handPoint, 0.05);
          if (since < 40) block.position.copy(target);
          else block.position.lerp(target, 1 - Math.exp(-delta * 30));
          tilt.set(inertia.pitch, 0, inertia.roll);
          block.quaternion.copy(CARRY_TURN).multiply(tiltTurn.setFromEuler(tilt));
          const pop = Math.min(1, Math.max(0, clock - Math.max(arrivedAt.current, attachedAt.current)) / 160);
          block.scale.setScalar(0.88 + 0.12 * (1 - (1 - pop) ** 3));
        }
        if (DEV_HANDLE) {
          const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop;
          if (handle) {
            const carry = (handle.carry ??= {}) as Record<string, unknown>;
            carry[playerId] = { since, holding, x: block.position.x, y: block.position.y, z: block.position.z, anchor: anchor.toArray() };
          }
        }
      }
    }
  });

  useFrame(() => {
    const shadow = ground.current;
    const owner = root.current?.parent;
    if (!shadow || !owner) return;
    const lift = (owner.userData.lift as number | undefined) ?? 0;
    const scale = owner.scale.y || 1;
    shadow.position.y = -lift / scale;
    const air = Math.min(1, lift / SHADOW_FADE_HEIGHT);
    shadow.scale.setScalar(1 - air * 0.3);
    const disc = shadow.children[0] as Mesh | undefined;
    const uniform = (disc?.material as ShaderMaterial | undefined)?.uniforms?.uOpacity;
    if (uniform) uniform.value = PERFORMER_SHADOW * (1 - air * 0.55);
  });

  return (
    <group ref={root} {...props}>
      <group ref={ground}>
        <SoftDisc radius={0.9} opacity={PERFORMER_SHADOW} y={-0.715} />
      </group>
      <group ref={animationRoot} position={[0, RIG_FOOT_OFFSET, 0]} scale={RIG_SCALE} dispose={null}>
        <primitive object={cloned} />
      </group>
      <mesh ref={wave} visible={false} position={[0, -0.7, 0.55]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <ringGeometry args={[0.64, 0.78, 32, 1, Math.PI * 0.74, Math.PI * 1.52]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {shown && (
        <group ref={carried} position={[anchor.x, anchor.y, anchor.z]} quaternion={CARRY_TURN}>
          <Vinyl role={shown.role} family={shown.family} sampleName={shown.sampleName} fx={shown.fx} size={CARRIED_SIZE} glow={0.45} />
        </group>
      )}
    </group>
  );
}

const IMPACT_MS = 260;

const TWIST_SHARES: Array<[string, number, number, number]> = [
  ['Abdomen', 0.3, 0.04, 0.4],
  ['Torso', 0.4, 0.1, 0.6],
  ['Head', 0.3, 0.2, -0.45],
];

const RUN_SPRINT_CLIPS = new Set([CLIP.sprint, CLIP.sprintHot].map((name) => `${name}${LOWER_SUFFIX}`));
const RUN_HOT_ON = 0.58;
const RUN_HOT_OFF = 0.52;
const RUN_RIGHT_FOOT = 0.21;
const RUN_FREE_SPAN = 0.52;
const RUN_BASE = 0.3;
const RUN_HOP_BASE = 0.01;
const RUN_HOP = 0.04;
const RUN_STRETCH = 0.02;
const RUN_SQUASH = 0.03;
const RUN_LEAN_BASE = 0.04;
const RUN_LEAN = 0.06;
const RIG_FLOOR_Y = -0.715;

const floorAt = new Vector3();
const BEAT_DIP = 0.05;
const BEAT_SQUASH = 0.05;
const STRETCH_PER_SPEED = 0.04;
const SQUASH_PER_ACCEL = 0.0014;
const side = new Vector3();
const nod = new Quaternion();
const TWIST_MAX = 1.05;
const forward = new Vector3();
const handPoint = new Vector3();
const up = new Vector3();
const turn = new Quaternion();
const parentTurn = new Quaternion();
const local = new Quaternion();
const scratch = new Vector3();
const target = new Vector3();
const worldAt = new Vector3();
const velocity = new Vector3();
const accel = new Vector3();
const tilt = new Euler();
const tiltTurn = new Quaternion();
const spin = new Quaternion();
const spinAxis = new Vector3(0, 1, 0);
const bend = new Vector3();
const SWAY_GAIN = 0.018;
const SWAY_MAX = 0.28;
const SWAY_STIFF = 170;
const SWAY_DAMP = 12;
const CARRY_OFFSET = new Vector3(0, -0.06, 0.2);
const PICKUP_FADE = 0.07;
const CARRIED_SIZE = 0.74;
const CARRY_TURN = new Quaternion().setFromEuler(new Euler(0.12, 0.2, 0.05));

type CarriedRecord = { id: string | null; role: SampleRole; family?: string; sampleName: string | null; fx?: FxSet };
type LocalPose = { position: Vector3; quaternion: Quaternion; scale: number };
type LetGo = { record: CarriedRecord; opensAt: number; from: LocalPose | null; flightMs: number; arc: number };

const rootTurn = new Quaternion();
const rootScale = new Vector3();

function toCharacterSpace(root: Object3D, pose: { position: Vector3; quaternion: Quaternion; scale: number }, out: LocalPose): LocalPose {
  root.getWorldQuaternion(rootTurn);
  root.getWorldScale(rootScale);
  out.position.copy(pose.position);
  root.worldToLocal(out.position);
  out.quaternion.copy(rootTurn).invert().multiply(pose.quaternion);
  out.scale = pose.scale / (rootScale.x * CARRIED_SIZE);
  return out;
}

function flyBetween(block: Object3D, from: LocalPose, to: LocalPose, t: number, along: number, arc: number) {
  bend.lerpVectors(from.position, to.position, 0.5);
  bend.y += arc * 2;
  const a = 1 - along;
  block.position.set(0, 0, 0)
    .addScaledVector(from.position, a * a)
    .addScaledVector(bend, 2 * a * along)
    .addScaledVector(to.position, along * along);
  block.quaternion.slerpQuaternions(from.quaternion, to.quaternion, smooth(t));
  block.quaternion.multiply(spin.setFromAxisAngle(spinAxis, (1 - along) ** 2 * HANDOFF_SPIN));
  block.scale.setScalar(from.scale + (to.scale - from.scale) * along);
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function clamp01(t: number) {
  return Math.max(0, Math.min(1, t));
}

const ikShoulder = new Vector3();
const ikElbow = new Vector3();
const ikEnd = new Vector3();
const ikAim = new Vector3();
const ikBend = new Vector3();
const ikFrom = new Vector3();
const ikTo = new Vector3();
const ikTurn = new Quaternion();
const ikWorld = new Quaternion();
const ikParent = new Quaternion();

function aimBone(bone: Object3D, from: Vector3, to: Vector3, weight: number) {
  if (!bone.parent || from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  ikTurn.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(ikWorld).premultiply(ikTurn);
  bone.parent.getWorldQuaternion(ikParent);
  ikWorld.premultiply(ikParent.invert());
  bone.quaternion.slerp(ikWorld, weight);
  bone.updateMatrixWorld(true);
}

function reachFor(upper: Object3D, lower: Object3D, end: Object3D, goal: Vector3, weight: number) {
  upper.getWorldPosition(ikShoulder);
  lower.getWorldPosition(ikElbow);
  end.getWorldPosition(ikEnd);
  const upperLength = ikShoulder.distanceTo(ikElbow);
  const lowerLength = ikElbow.distanceTo(ikEnd);
  ikAim.subVectors(goal, ikShoulder);
  const distance = Math.min(Math.max(ikAim.length(), Math.abs(upperLength - lowerLength) + 1e-3), (upperLength + lowerLength) * 0.999);
  ikAim.normalize();
  ikBend.subVectors(ikElbow, ikShoulder);
  ikBend.addScaledVector(ikAim, -ikBend.dot(ikAim));
  if (ikBend.lengthSq() < 1e-8) ikBend.set(0, -1, 0).addScaledVector(ikAim, ikAim.y);
  ikBend.normalize();
  const cos = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance);
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  ikTo.copy(ikAim).multiplyScalar(cos * upperLength).addScaledVector(ikBend, sin * upperLength);
  aimBone(upper, ikFrom.subVectors(ikElbow, ikShoulder), ikTo, weight);
  lower.getWorldPosition(ikElbow);
  end.getWorldPosition(ikEnd);
  ikTo.copy(ikShoulder).addScaledVector(ikAim, distance).sub(ikElbow);
  aimBone(lower, ikFrom.subVectors(ikEnd, ikElbow), ikTo, weight);
}

const DEFAULT_ANCHOR = new Vector3(0, -0.13, 0.56);
const anchors = new Map<string, Vector3>();
function anchorFor(rigFile: string) {
  let anchor = anchors.get(rigFile);
  if (!anchor) {
    anchor = DEFAULT_ANCHOR.clone();
    anchors.set(rigFile, anchor);
  }
  return anchor;
}

function danceFor(state: GameState, now: number, band: number, playerId: string, grooveTime: number): string | null {
  const epoch = visualEpoch(state);
  if (epoch === null || now < epoch) return null;
  if (state.phase === 'complete') {
    if ((replayClock(state, now)?.section ?? -1) < 0) return 'Watch_Nod';
    return danceAt(performerDances(state.themeId)[band]!, playerId, Math.floor(grooveTime / 2));
  }
  if (state.phase !== 'playing') return null;
  if (isOvertime(state, now)) return 'Nervous';
  return danceAt(performerDances(state.themeId)[band]!, playerId, Math.floor(grooveTime / 2));
}

function scriptedDance(playerId: string, now: number): { clip: string; lagMs?: number } | null {
  const hook = (window as unknown as { __loop?: { dance?: (playerId: string, now: number) => { clip: string; lagMs?: number } | null } }).__loop?.dance;
  return hook?.(playerId, now) ?? null;
}

const LOBBY_IDLES = ['Idle_Lobby_A', 'Idle_Lobby_B', 'Idle_Lobby_C'];
function playerHash(playerId: string) {
  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) hash = (hash * 31 + playerId.charCodeAt(i)) | 0;
  return hash;
}
export function lobbyIdleFor(playerId: string) {
  return LOBBY_IDLES[Math.abs(playerHash(playerId)) % LOBBY_IDLES.length]!;
}
export function idlePhaseFor(playerId: string) {
  return ((playerHash(playerId) >>> 8) % 997) / 997;
}
export function idleSecondsAt(playerId: string, duration: number, roomMs: number) {
  const at = roomMs / 1000 / duration + idlePhaseFor(playerId);
  return (at - Math.floor(at)) * duration;
}

function splitClip(clip: AnimationClip, suffix: string, test: RegExp): AnimationClip | null {
  const tracks = clip.tracks.filter((track) => test.test(track.name));
  if (!tracks.length) return null;
  return new AnimationClip(`${clip.name}${suffix}`, clip.duration, tracks);
}

function buildLayeredClips(animations: AnimationClip[]): AnimationClip[] {
  const result = [...animations];
  for (const clip of animations) {
    const lower = splitClip(clip, LOWER_SUFFIX, LOWER_BODY);
    if (lower) result.push(lower);
    const upper = splitClip(clip, UPPER_SUFFIX, UPPER_BODY);
    if (upper) result.push(upper);
  }
  return result;
}

const layered = new WeakMap<AnimationClip[], AnimationClip[]>();
function layeredClips(rig: AnimationClip[], moves: AnimationClip[]) {
  let clips = layered.get(rig);
  if (!clips) {
    const missing = [...PERFORMER_STYLE_CLIPS, CLIP.sprintHot].filter((name) => !moves.some((clip) => clip.name === name));
    if (missing.length) throw new Error(`${MOVES_FILE} has no ${missing.join(', ')}`);
    clips = buildLayeredClips([...rig, ...moves]);
    layered.set(rig, clips);
  }
  return clips;
}

export function rigForPlayer(playerId: string, color: string) {
  const seed = `${playerId}:${PLAYER_COLORS.indexOf(color)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return RIG_FILES[Math.abs(hash) % RIG_FILES.length]!;
}
