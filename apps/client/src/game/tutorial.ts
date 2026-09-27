import { create } from 'zustand';

export type Lesson = 'move' | 'take' | 'place' | 'machine' | 'print';

const LESSONS: Lesson[] = ['move', 'take', 'place', 'machine', 'print'];
const STORAGE_KEY = 'ktb-tutorial';

type Saved = { learned: Lesson[]; retired: boolean };

type TutorialState = {
  learned: ReadonlySet<Lesson>;
  retired: boolean;
  learn: (lesson: Lesson) => void;
  retire: () => void;
  restart: () => void;
};

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { learned: [], retired: false };
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return {
      learned: (parsed.learned ?? []).filter((lesson): lesson is Lesson => LESSONS.includes(lesson as Lesson)),
      retired: parsed.retired === true,
    };
  } catch {
    return { learned: [], retired: false };
  }
}

function save(learned: ReadonlySet<Lesson>, retired: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ learned: [...learned], retired } satisfies Saved));
  } catch {}
}

const saved = load();

export const useTutorial = create<TutorialState>((set, get) => ({
  learned: new Set(saved.learned),
  retired: saved.retired,
  learn: (lesson) => {
    const { learned, retired } = get();
    if (learned.has(lesson)) return;
    const next = new Set(learned).add(lesson);
    const done = retired || LESSONS.every((each) => next.has(each));
    save(next, done);
    set({ learned: next, retired: done });
  },
  retire: () => {
    if (get().retired) return;
    save(get().learned, true);
    set({ retired: true });
  },
  restart: () => {
    const learned = new Set<Lesson>();
    save(learned, false);
    set({ learned, retired: false });
  },
}));

export const useGuideCue = create<{ press: boolean }>(() => ({ press: false }));

export function setGuideCue(press: boolean) {
  if (useGuideCue.getState().press !== press) useGuideCue.setState({ press });
}

export function isTouchLayout() {
  try {
    return window.matchMedia('(pointer: coarse), (max-width: 900px)').matches;
  } catch {
    return false;
  }
}
