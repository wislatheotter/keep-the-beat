export function eyeOpenness(now: number, offset = 0) {
  const t = ((now + offset) % 6700) / 1000;
  const blink = (at: number) => Math.max(0, 1 - Math.abs(t - at) / 0.095);
  return 1 - Math.max(blink(4.3), blink(4.58)) * 0.93;
}
