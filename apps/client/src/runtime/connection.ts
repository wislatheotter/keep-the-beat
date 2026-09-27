import { create } from 'zustand';

export type ConnectionStatus = 'live' | 'reconnecting' | 'closed';

export const useConnection = create<{ status: ConnectionStatus; reason: string | null }>(() => ({
  status: 'live',
  reason: null,
}));

export function setConnection(status: ConnectionStatus, reason: string | null = null) {
  useConnection.setState({ status, reason });
}
