type Script = { duration: number; sourceURL?: string; sourceFunctionName?: string; invoker?: string };
type LongFrame = {
  startTime: number;
  duration: number;
  renderStart?: number;
  styleAndLayoutStart?: number;
  scripts?: Script[];
};

const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
let lastHeap = 0;
export function sampleHeap() {
  const before = lastHeap;
  lastHeap = heap();
  return before;
}

const longFrames: LongFrame[] = [];
const hitches: string[] = [];
let observing = false;

function observe() {
  if (observing || typeof PerformanceObserver === 'undefined') return;
  observing = true;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as LongFrame[]) {
        longFrames.push(entry);
        if (longFrames.length > 200) longFrames.splice(0, 100);
      }
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch {
  }
  const handle = ((window as unknown as { __loop?: Record<string, unknown> }).__loop ??= {});
  handle.hitches = () => hitches.join('\n');
}

const short = (url = '') => url.replace(/^.*\/(src|assets|deps)\//, '').replace(/\?.*$/, '');

export function noteHitch(ms: number, typical: number, at: number, where: string, pacer: {
  waited: number; lastCpu: number; late: number; heapBefore: number;
  programs: number; textures: number;
}) {
  observe();
  const heapAfter = heap();
  window.setTimeout(() => {
    const from = at - ms - 20;
    const causes = longFrames.filter((frame) => frame.startTime + frame.duration >= from && frame.startTime <= at + 5);
    const scripts = causes.flatMap((frame) => frame.scripts ?? [])
      .filter((script) => script.duration >= 2)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 4)
      .map((script) => `${short(script.sourceURL)}${script.sourceFunctionName ? `:${script.sourceFunctionName}` : ''} ${script.duration.toFixed(0)}ms (${script.invoker ?? ''})`);
    const busy = causes.reduce((sum, frame) => sum + frame.duration, 0);
    const split = causes.map((frame) => {
      const end = frame.startTime + frame.duration;
      const script = (frame.scripts ?? []).reduce((sum, each) => sum + each.duration, 0);
      const layout = frame.styleAndLayoutStart ? end - frame.styleAndLayoutStart : 0;
      return `scripts ${script.toFixed(0)} · style/layout/paint ${layout.toFixed(0)} · other ${Math.max(0, frame.duration - script - layout).toFixed(0)}`;
    }).join(' | ');
    const freed = pacer.heapBefore && heapAfter ? (pacer.heapBefore - heapAfter) / 1e6 : 0;
    const gc = freed > 4 ? `; heap fell ${freed.toFixed(0)} MB (a collection), now ${(heapAfter / 1e6).toFixed(0)} MB` : heapAfter ? `; heap ${(heapAfter / 1e6).toFixed(0)} MB` : '';
    const own = `GPU waited ${pacer.waited} refresh${pacer.waited === 1 ? '' : 'es'}, last frame ${pacer.lastCpu.toFixed(0)} ms of script, callback ${pacer.late.toFixed(0)} ms late`;
    const built = [
      pacer.programs > 0 ? `${pacer.programs} new shader program${pacer.programs === 1 ? '' : 's'}` : '',
      pacer.textures > 0 ? `${pacer.textures} new texture${pacer.textures === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(', ');
    const line = `[hitch] ${ms.toFixed(0)} ms (usually ${typical.toFixed(0)}) at ${(at / 1000).toFixed(2)} s, ${where}: ${own}`
      + (built ? `; ${built}` : '')
      + gc
      + (causes.length ? `; long frame ${busy.toFixed(0)} ms (${split}) — ${scripts.join('; ') || 'no script of note'}` : '');
    hitches.push(line);
    if (hitches.length > 300) hitches.splice(0, 100);
    console.warn(line);
  }, 300);
}

export function startHitchLog() {
  observe();
}
