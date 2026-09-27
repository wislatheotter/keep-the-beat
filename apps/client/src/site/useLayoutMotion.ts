import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export function useLayoutMotion(ref: RefObject<HTMLElement | null>) {
  const seen = useRef<Map<HTMLElement, Place> | null>(null);
  const swaps = useRef(new WeakSet<Element>());
  const moving = useRef(new WeakMap<Element, Animation>());

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const before = seen.current;
    const now = measure(root);
    seen.current = now;
    const labels = root.querySelectorAll('[data-swap]');
    if (!before || still.matches) {
      labels.forEach((label) => swaps.current.add(label));
      return;
    }

    for (const [el, was] of before) {
      if (now.has(el) || !was.parent.isConnected) continue;
      ghost(el, was);
    }

    for (const [el, is] of now) {
      const was = before.get(el);
      if (!was) {
        if (el !== root) el.animate(ENTER_FRAMES, ENTER);
        continue;
      }
      const dx = was.x - is.x;
      const dy = was.y - is.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      moving.current.get(el)?.cancel();
      moving.current.set(el, el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], MOVE));
    }

    labels.forEach((label) => {
      if (swaps.current.has(label)) return;
      swaps.current.add(label);
      label.animate([{ opacity: 0 }, { opacity: 1 }], SWAP);
    });
  });

  useEffect(() => {
    const remeasure = () => {
      if (ref.current) seen.current = measure(ref.current);
    };
    window.addEventListener('resize', remeasure);
    return () => window.removeEventListener('resize', remeasure);
  }, [ref]);
}

type Place = { parent: HTMLElement; x: number; y: number; w: number; h: number };

const still = window.matchMedia('(prefers-reduced-motion: reduce)');

const EASE = 'cubic-bezier(0.2, 0.8, 0.25, 1)';
const MOVE: KeyframeAnimationOptions = { duration: 260, easing: EASE };
const ENTER: KeyframeAnimationOptions = { duration: 220, delay: 70, easing: EASE, fill: 'backwards' };
const ENTER_FRAMES: Keyframe[] = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];
const EXIT: KeyframeAnimationOptions = { duration: 150, easing: 'ease-in', fill: 'forwards' };
const SWAP: KeyframeAnimationOptions = { duration: 180, easing: 'ease-out' };

function measure(root: HTMLElement) {
  const places = new Map<HTMLElement, Place>();
  const watched = [root, ...root.children, ...root.querySelectorAll(':scope > .gate > *')];
  for (const node of watched) {
    const el = node as HTMLElement;
    const parent = el.parentElement;
    if (!parent || el.closest('[data-ghost]')) continue;
    places.set(el, { parent, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  }
  return places;
}

function ghost(el: HTMLElement, was: Place) {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  copy.dataset.ghost = '';
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  Object.assign(copy.style, {
    position: 'absolute',
    left: `${was.x}px`,
    top: `${was.y}px`,
    width: `${was.w}px`,
    height: `${was.h}px`,
    margin: '0',
    boxSizing: 'border-box',
    pointerEvents: 'none',
  });
  was.parent.appendChild(copy);
  copy.animate([{ opacity: 1 }, { opacity: 0 }], EXIT).finished.then(
    () => copy.remove(),
    () => copy.remove(),
  );
}
