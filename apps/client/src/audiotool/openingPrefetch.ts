import { THEME_IDS, makeRunSeed, openingManifest, type ThemeId } from '@loop/shared';
import { sampleLibrary } from './sampleLibrary';

export type Opening = { themeId: ThemeId; runSeed: number };

export function chooseOpening(): Opening {
  return { themeId: THEME_IDS[Math.floor(Math.random() * THEME_IDS.length)]!, runSeed: makeRunSeed() };
}

export async function prefetchOpening(opening: Opening, signal: AbortSignal) {
  await sampleLibrary.cacheBytes(openingManifest(opening.themeId, opening.runSeed), { signal, concurrency: 4 });
  if (signal.aborted) return;
  const rest = THEME_IDS.filter((id) => id !== opening.themeId).flatMap((id) => openingManifest(id, opening.runSeed));
  await sampleLibrary.cacheBytes(rest, { signal, concurrency: 3 });
}
