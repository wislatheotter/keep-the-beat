import { create } from 'zustand';

export const useEntry = create<{
  assets: number;
  lights: number | null;
}>(() => ({ assets: 0, lights: null }));

export const reportAssets = (assets: number) => useEntry.setState({ assets });
export const reportLights = (lights: number | null) => useEntry.setState({ lights });
