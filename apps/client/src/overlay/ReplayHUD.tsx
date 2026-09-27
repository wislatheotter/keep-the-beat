import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { isAirborne, theme } from '@loop/shared';
import { useGameRuntime, useGameState } from '../runtime/GameRuntimeContext';
import { useShowAudio } from '../audio/ShowAudioProvider';
import { useAudiotool } from '../audiotool/AudiotoolProvider';
import { TouchPad } from './TouchPad';
import { Icon } from './icons';
import { useBeatPulse } from './useBeatPulse';
import { HudLead } from './HudLead';

export function ReplayHUD({ entering, onLeave }: { entering: boolean; onLeave: () => void }) {
  const state = useGameState();
  const runtime = useGameRuntime();
  const showAudio = useShowAudio();
  const audiotool = useAudiotool();
  const isHost = state.hostId === runtime.playerId;
  const kit = theme(state.themeId);
  const root = useRef<HTMLDivElement>(null);
  useBeatPulse(root);

  const jump = useCallback(() => {
    void showAudio.unlock();
    const current = runtime.getState();
    const me = current.players[runtime.playerId];
    if (!me || isAirborne(me.jumpAt, runtime.now())) return;
    runtime.dispatch({ type: 'JUMP', playerId: runtime.playerId, now: runtime.now() });
  }, [runtime, showAudio]);

  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.repeat || !['Space', 'KeyW', 'ArrowUp'].includes(event.code)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      event.preventDefault();
      jump();
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [jump]);

  const exported = !!audiotool.projectUrl;
  const exportable = exported || audiotool.canExport || audiotool.canLogin;
  return (
    <div
      ref={root}
      className={`replay-hud hud${entering ? ' is-entering' : ' is-live'}`}
      style={{ ['--accent' as string]: kit.look.accent } as CSSProperties}
    >
      <div className="hud-top replay-top">
        <HudLead onLeave={onLeave}>
          <div className="replay-actions">
            <button
              type="button"
              className="hud-pill is-export"
              disabled={audiotool.exporting || !exportable}
              onClick={() => {
                if (audiotool.projectUrl) window.open(audiotool.projectUrl, '_blank', 'noopener,noreferrer');
                else if (audiotool.canExport) void audiotool.exportShow();
                else void audiotool.connect();
              }}
            >
              <span>{exported ? 'Open in Audiotool' : audiotool.exporting ? 'Sending…' : 'Send to Audiotool'}</span>
              <Icon name="export" />
            </button>
            {isHost ? (
              <button
                type="button"
                className="hud-pill is-accent"
                onClick={() => runtime.dispatch({ type: 'OPEN_LOBBY', playerId: runtime.playerId, now: runtime.now() })}
              >
                <span>Continue</span>
                <Icon name="next" className="hud-arrow" />
              </button>
            ) : (
              <div className="hud-pill lobby-wait">
                <i />
                <span>Waiting for the host</span>
              </div>
            )}
          </div>
        </HudLead>
      </div>

      <TouchPad />
      <button
        type="button"
        className="action-button hud-action replay-jump"
        aria-label="Jump"
        onPointerDown={(event) => { event.preventDefault(); jump(); }}
      >
        <span className="hud-action-slot is-empty" />
        <span className="hud-action-glyph">
          <Icon name="jump" />
        </span>
      </button>
    </div>
  );
}
