import { create } from 'zustand';

export const useBackstage = create<{
  backstage: boolean;
  rehearsing: string | null;
  dressed: boolean;
}>(() => ({ backstage: false, rehearsing: null, dressed: false }));

export const setBackstage = (backstage: boolean) => useBackstage.setState({ backstage });
export const setDressed = () => useBackstage.setState({ dressed: true });
export const setRehearsing = (rehearsing: string | null) => {
  if (useBackstage.getState().rehearsing !== rehearsing) useBackstage.setState({ rehearsing });
};
