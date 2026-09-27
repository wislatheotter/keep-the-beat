import { create } from 'zustand';

export const COVER_SIZE = 512;

type Cover = { show: number | null; url: string | null };

export const useCover = create<Cover>(() => ({ show: null, url: null }));

export function setCover(show: number, blob: Blob) {
  const previous = useCover.getState().url;
  if (previous) URL.revokeObjectURL(previous);
  useCover.setState({ show, url: URL.createObjectURL(blob) });
}

export function coverUrlFor(completedAt: number | null): string | null {
  const cover = useCover.getState();
  return completedAt !== null && cover.show === completedAt ? cover.url : null;
}
