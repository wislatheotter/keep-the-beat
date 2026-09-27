export function getOrCreatePlayerId() {
  const tab = readTabId();
  if (tab) return tab;
  const key = 'audiotool-loop-player-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = randomPlayerId();
  localStorage.setItem(key, value);
  return value;
}

const TAB_KEY = 'ktb-tab-player-id';

function readTabId() {
  try { return sessionStorage.getItem(TAB_KEY); } catch { return null; }
}

let claimed: Promise<string> | null = null;

export function claimPlayerId(): Promise<string> {
  return claimed ??= (async () => {
    const candidate = getOrCreatePlayerId();
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) return candidate;
    const id = await hold(locks, candidate) ? candidate : randomPlayerId();
    if (id !== candidate) await hold(locks, id);
    try { sessionStorage.setItem(TAB_KEY, id); } catch {}
    return id;
  })();
}

function hold(locks: LockManager, id: string): Promise<boolean> {
  return new Promise((resolve) => {
    locks.request(`ktb-player:${id}`, { signal: AbortSignal.timeout(1500) }, () => {
      resolve(true);
      return new Promise<void>(() => {});
    }).catch((error: unknown) => resolve(!(error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError'))));
  });
}

function randomPlayerId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
