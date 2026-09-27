const BEHIND_MS = 700;
const BEHIND_COUNT = 3;
const CALM_MS = 250;
const CALM_FOR_MS = 10_000;
const CALM_FOR_MAX_MS = 120_000;
const RELAPSE_MS = 30_000;
export const PACE_MS = 500;
const BASELINE_CREEP = 0.004;

export class LinkPacer {
  pace = 0;
  private baseline = Infinity;
  private seenAt = 0;
  private behind = 0;
  private calmSince = 0;
  private calmFor = CALM_FOR_MS;
  private releasedAt = -Infinity;
  queue = 0;

  observe(serverNow: number, at: number): number | null {
    const raw = at - serverNow;
    if (Number.isFinite(this.baseline)) this.baseline += Math.max(0, at - this.seenAt) * BASELINE_CREEP;
    this.seenAt = at;
    if (raw < this.baseline) this.baseline = raw;
    this.queue = raw - this.baseline;

    if (this.queue > BEHIND_MS) {
      this.behind += 1;
      this.calmSince = 0;
    } else {
      this.behind = 0;
      if (this.queue < CALM_MS) this.calmSince ||= at;
      else this.calmSince = 0;
    }

    if (!this.pace && this.behind >= BEHIND_COUNT) {
      this.calmFor = at - this.releasedAt < RELAPSE_MS ? Math.min(CALM_FOR_MAX_MS, this.calmFor * 2) : CALM_FOR_MS;
      this.pace = PACE_MS;
      this.calmSince = 0;
      return this.pace;
    }
    if (this.pace && this.calmSince && at - this.calmSince > this.calmFor) {
      this.pace = 0;
      this.releasedAt = at;
      return 0;
    }
    return null;
  }

  reset() {
    this.baseline = Infinity;
    this.behind = 0;
    this.calmSince = 0;
  }
}
