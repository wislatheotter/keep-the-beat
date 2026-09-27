const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
export const decorativeMotion = () => preference.matches ? 0.15 : 1;
