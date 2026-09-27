import { useEffect, useRef, useState, type AnimationEvent } from 'react';
import { useEntry } from '../entry';
import './curtain.css';

export type CurtainStep = 'room' | 'code' | 'stage' | 'lights' | 'ready';

const FADE_OUT_MS = 380;
const COVERED_AFTER_MS = 420;

export function Curtain({ up, mode, onCovered, joining, codeReady, roomReady }: {
  up: boolean;
  mode: 'enter' | 'leave';
  onCovered: () => void;
  joining: boolean;
  codeReady: boolean;
  roomReady: boolean;
}) {
  const [mounted, setMounted] = useState(up);
  const [leaving, setLeaving] = useState(false);
  const covered = useRef(false);
  const report = useRef(onCovered);
  report.current = onCovered;

  const reportCovered = () => {
    if (covered.current) return;
    covered.current = true;
    report.current();
  };

  useEffect(() => {
    if (up) {
      covered.current = false;
      setMounted(true);
      setLeaving(false);
      const timer = window.setTimeout(reportCovered, COVERED_AFTER_MS);
      return () => window.clearTimeout(timer);
    }
    if (!mounted) return;
    setLeaving(true);
    const timer = window.setTimeout(() => { setMounted(false); setLeaving(false); }, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [up]);

  if (!mounted) return null;
  return (
    <CurtainBody
      leaving={leaving}
      mode={mode}
      joining={joining}
      codeReady={codeReady}
      roomReady={roomReady}
      onRisen={(event) => { if (event.animationName === 'curtain-in' && up) reportCovered(); }}
    />
  );
}

function CurtainBody({ leaving, mode, joining, codeReady, roomReady, onRisen }: {
  leaving: boolean;
  mode: 'enter' | 'leave';
  joining: boolean;
  codeReady: boolean;
  roomReady: boolean;
  onRisen: (event: AnimationEvent<HTMLDivElement>) => void;
}) {
  const assets = useEntry((entry) => entry.assets);
  const lights = useEntry((entry) => entry.lights);

  const step: CurtainStep = leaving ? 'ready'
    : joining && !roomReady ? 'room'
    : !codeReady ? 'code'
    : lights === null ? 'stage'
    : lights < 1 ? 'lights'
    : 'ready';
  const steps: CurtainStep[] = joining ? ['room', 'code', 'stage', 'lights'] : ['code', 'stage', 'lights'];

  const raw = leaving || step === 'ready' ? 1 : progressOf(step, steps, assets, lights ?? 0);
  const high = useRef(0);
  high.current = Math.max(high.current, raw);

  return (
    <div className={`curtain${leaving ? ' is-leaving' : ''}${mode === 'leave' ? ' is-quiet' : ''}`} role="status" aria-live="polite" data-step={step} onAnimationEnd={onRisen}>
      <div className="curtain-backdrop" aria-hidden="true"><i /><b /><b /></div>
      <div className="curtain-body">
        <div className="curtain-mark" aria-hidden="true">
          <svg className="curtain-head" viewBox="0 0 128 128" width="128" height="128">
            <g transform="translate(6.4 6.4) scale(0.9)">
              <path d="M64 121C38 121 19 103 19 79c0-18 8-32 22-40l-6-22C32 7 36 3 43 5c8 2 13 16 15 29 4-1 8-1 12 0C74 21 81 7 90 5c7-2 12 3 9 12L88 40c13 8 21 22 21 39 0 24-19 42-45 42Z" fill="#f4f2ee" />
              <path d="M42 14c5 5 8 15 9 26l-7 4c-1-13-4-24-2-30Zm51 0c-5 5-8 15-10 27l-7-4c4-12 11-23 17-23Z" fill="#ff4e96" />
            </g>
          </svg>
          <div className="curtain-vinyl">
            <svg viewBox="0 0 70 70" width="70" height="70">
              <circle cx="35" cy="35" r="35" fill="#22232b" />
              <path d="M8 36c0-15 12-27 27-28v5C23 14 13 24 13 36Zm54 0c0 15-12 27-27 28v-5c12-1 22-11 22-23Z" fill="#50505b" />
              <circle cx="35" cy="35" r="13" fill="#ff4e96" />
              <circle cx="35" cy="35" r="3.5" fill="#f4f2ee" />
            </svg>
          </div>
        </div>

        <p className="curtain-kicker">Loading</p>
        <p className="curtain-words">
          Keep the Beat<span className="curtain-dot">.</span>
        </p>

        <div className="curtain-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${high.current.toFixed(3)})` }} />
        </div>

        <ol className="curtain-steps">
          {steps.map((each) => {
            const at = steps.indexOf(step);
            const index = steps.indexOf(each);
            const state = leaving || step === 'ready' || index < at ? 'done' : index === at ? 'now' : 'next';
            return <li key={each} className={`is-${state}`}>{LABELS[each]}</li>;
          })}
        </ol>
      </div>
    </div>
  );
}

const LABELS: Record<CurtainStep, string> = {
  room: 'Room',
  code: 'Code',
  stage: 'Stage',
  lights: 'Lights',
  ready: 'Ready',
};

const WEIGHT: Record<CurtainStep, number> = { room: 0.12, code: 0.14, stage: 0.54, lights: 0.2, ready: 0 };

function progressOf(step: CurtainStep, steps: CurtainStep[], assets: number, lights: number) {
  const total = steps.reduce((sum, each) => sum + WEIGHT[each], 0);
  let done = 0;
  for (const each of steps) {
    if (each === step) break;
    done += WEIGHT[each];
  }
  const within = step === 'stage' ? assets : step === 'lights' ? lights : 0.35;
  return Math.min(1, (done + WEIGHT[step] * Math.min(1, Math.max(0, within))) / total);
}
