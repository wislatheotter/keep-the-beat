import type { ReactNode } from 'react';
import { useConnection } from '../runtime/connection';
import { Icon } from './icons';

export function HudLead({ onLeave, children }: { onLeave: () => void; children?: ReactNode }) {
  const status = useConnection((connection) => connection.status);
  return (
    <div className="hud-lead">
      <button type="button" className="hud-round hud-quiet hud-back" onClick={onLeave} aria-label="Leave the show">
        <Icon name="back" />
      </button>
      {status === 'reconnecting' && (
        <p className="hud-pill hud-quiet room-notice" role="status" aria-label="Reconnecting">
          <i />
          <span>Reconnecting…</span>
        </p>
      )}
      {children}
    </div>
  );
}
