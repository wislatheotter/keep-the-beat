import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

export type LoadLevel = 'calm' | 'busy' | 'full';

type Reading = { elu: number; delayMs: number };
type Rule = { elu: number; delayMs: number; seconds: number };

const BUSY_ENTER: Rule = { elu: 0.8, delayMs: 30, seconds: 3 };
const BUSY_LEAVE: Rule = { elu: 0.6, delayMs: 12, seconds: 20 };
const FULL_ENTER: Rule = { elu: 0.95, delayMs: 45, seconds: 5 };
const FULL_LEAVE: Rule = { elu: 0.75, delayMs: 25, seconds: 15 };

const over = (reading: Reading, rule: Rule) => reading.elu > rule.elu || reading.delayMs > rule.delayMs;
const under = (reading: Reading, rule: Rule) => reading.elu < rule.elu && reading.delayMs < rule.delayMs;

export class Load {
  level: LoadLevel = 'calm';
  reading: Reading = { elu: 0, delayMs: 0 };
  private streaks = { busyEnter: 0, busyLeave: 0, fullEnter: 0, fullLeave: 0 };

  constructor(private readonly onChange: (level: LoadLevel, reading: Reading) => void) {
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    let last = performance.eventLoopUtilization();
    setInterval(() => {
      const now = performance.eventLoopUtilization();
      const elu = performance.eventLoopUtilization(now, last).utilization;
      last = now;
      const delayMs = delay.count ? delay.percentile(99) / 1e6 : 0;
      delay.reset();
      this.read({ elu, delayMs });
    }, 1000).unref();
  }

  read(reading: Reading) {
    this.reading = reading;
    const s = this.streaks;
    s.busyEnter = over(reading, BUSY_ENTER) ? s.busyEnter + 1 : 0;
    s.busyLeave = under(reading, BUSY_LEAVE) ? s.busyLeave + 1 : 0;
    s.fullEnter = over(reading, FULL_ENTER) ? s.fullEnter + 1 : 0;
    s.fullLeave = under(reading, FULL_LEAVE) ? s.fullLeave + 1 : 0;

    let level = this.level;
    if (s.fullEnter >= FULL_ENTER.seconds) level = 'full';
    else if (level === 'full' && s.fullLeave >= FULL_LEAVE.seconds) level = 'busy';
    if (level === 'calm' && s.busyEnter >= BUSY_ENTER.seconds) level = 'busy';
    else if (level === 'busy' && s.busyLeave >= BUSY_LEAVE.seconds) level = 'calm';
    if (level === this.level) return;
    this.level = level;
    this.onChange(level, reading);
  }
}
