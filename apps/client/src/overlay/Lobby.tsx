import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { THEMES, theme } from '@loop/shared';
import { useGameRuntime, useGameState } from '../runtime/GameRuntimeContext';
import { useShowAudio, useShowAudioStatus } from '../audio/ShowAudioProvider';
import { useStageReady } from '../game/stage';
import { useBackstage } from '../game/backstage';
import { Icon } from './icons';
import { useBeatPulse } from './useBeatPulse';
import { LobbyRoster } from './LobbyRoster';
import { HudLead } from './HudLead';

export function LobbyOverlay({ leaving = false, asleep = false, onLeave }: { leaving?: boolean; asleep?: boolean; onLeave: () => void }) {
  const runtime = useGameRuntime();
  const state = useGameState();
  const showAudio = useShowAudio();
  const audioStatus = {
    preparing: useShowAudioStatus((status) => status.preparing),
    progress: useShowAudioStatus((status) => status.progress),
  };
  const [starting, setStarting] = useState(false);
  const [sheet, setSheet] = useState<'open' | 'closing' | null>(null);
  const isHost = state.hostId === runtime.playerId;
  const roomUrl = runtime.roomCode ? `${window.location.origin}/join/${runtime.roomCode}` : null;
  const picked = theme(state.themeId);
  const stageReady = useStageReady((store) => store.ready);
  const root = useRef<HTMLDivElement>(null);
  useBeatPulse(root, !useBackstage((store) => store.backstage) && !asleep);

  const loaded = audioStatus.preparing
    ? (audioStatus.progress.ready / Math.max(1, audioStatus.progress.total)) * 0.85
    : stageReady ? 1 : 0.9;

  useEffect(() => {
    if (sheet !== 'closing') return;
    const timer = window.setTimeout(() => setSheet(null), 320);
    return () => window.clearTimeout(timer);
  }, [sheet]);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await showAudio.unlock();
      runtime.startGame();
    } finally {
      setStarting(false);
    }
  };

  return (
    <div
      ref={root}
      className={`hud lobby-overlay${asleep ? ' is-asleep' : leaving ? ' is-leaving' : ' is-live'}`}
      style={{ ['--accent' as string]: picked.look.accent } as CSSProperties}
      inert={asleep}
      aria-hidden={asleep || undefined}
    >
      <i className="hud-progress" style={{ width: `${Math.round(loaded * 100)}%`, opacity: loaded >= 1 ? 0 : 1 }} />

      <div className="hud-top">
        <HudLead onLeave={onLeave} />
        <LobbyRoster asleep={asleep} />
        <div className="hud-corner">
          {runtime.mode === 'socket' && roomUrl && (
            <button type="button" className="lobby-code lobby-room" onClick={() => setSheet('open')} aria-label={`Room ${runtime.roomCode}, show the code`}>
              <span className="lobby-room-qr">
                <QRCodeSVG value={roomUrl} size={40} bgColor="transparent" fgColor="currentColor" />
              </span>
              <b>{runtime.roomCode}</b>
            </button>
          )}
        </div>
      </div>

      <div className="lobby-controls">
        <div className="lobby-pick">
          <ThemePicker themeId={state.themeId} disabled={!isHost} onPick={(id) => runtime.setTheme(id)} />
          {isHost && (
            <button type="button" className="hud-round" onClick={() => runtime.setTheme(null)} aria-label="Surprise us">
              <Icon name="dice" />
            </button>
          )}
        </div>

        {isHost ? (
          <button type="button" className="hud-pill is-accent lobby-start" disabled={starting} onClick={() => void start()}>
            <span>Start the show</span>
            <Icon name="next" className="hud-arrow" />
          </button>
        ) : (
          <div className="hud-pill lobby-wait">
            <i /> Waiting for the host
          </div>
        )}
      </div>

      {sheet && roomUrl && (
        <button
          type="button"
          className={`lobby-sheet${sheet === 'closing' ? ' is-closing' : ''}`}
          onClick={() => setSheet('closing')}
          aria-label="Hide the room code"
        >
          <div>
            <figure>
              <QRCodeSVG value={roomUrl} size={220} bgColor="transparent" fgColor="currentColor" />
            </figure>
            <b>{runtime.roomCode}</b>
            <small>{roomUrl.replace(/^https?:\/\//, '')}</small>
          </div>
        </button>
      )}

      {(
        <h1
          className={`intro-title${leaving ? '' : ' is-dormant'}`}
          aria-label={leaving ? picked.label : undefined}
          aria-hidden={leaving ? undefined : true}
        >
          {[...picked.label].map((letter, index) => (
            <span key={index} aria-hidden="true" style={{ ['--i' as string]: index } as CSSProperties}>
              {letter === ' ' ? ' ' : letter}
            </span>
          ))}
          <span className="intro-stop" aria-hidden="true" style={{ ['--i' as string]: picked.label.length } as CSSProperties}>
            .
          </span>
        </h1>
      )}
    </div>
  );
}

function ThemePicker({ themeId, disabled, onPick }: { themeId: string; disabled: boolean; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const picked = theme(themeId);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="picker" ref={root}>
      {open && (
        <div className="picker-menu" role="listbox" aria-label="Sound">
          {THEMES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={entry.id === themeId}
              data-theme={entry.id}
              className="lobby-theme"
              style={{ ['--tile' as string]: entry.look.accent } as CSSProperties}
              onClick={() => {
                onPick(entry.id);
                setOpen(false);
              }}
            >
              <i className="picker-dot" />
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="hud-pill picker-button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{ ['--tile' as string]: picked.look.accent } as CSSProperties}
        onClick={() => setOpen((value) => !value)}
      >
        <span key={picked.id}>
          <i className="picker-dot" />
          {picked.label}
        </span>
        <Icon name="chevron" />
      </button>
    </div>
  );
}
