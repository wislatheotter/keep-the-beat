import { Vector2, type WebGLRenderer } from 'three';
import { PERFORMANCE, QUALITY_REASON } from './performance';
import type { GovernorState } from './qualityGovernor';

export const PERF_READOUT = new URLSearchParams(window.location.search).has('perf');

export function createPerfReadout(gl: WebGLRenderer, governor: GovernorState) {
  const box = document.createElement('pre');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'fixed',
    left: '8px',
    top: 'calc(env(safe-area-inset-top, 0px) + 112px)',
    zIndex: '9999',
    margin: '0',
    padding: '6px 8px',
    maxWidth: 'min(76vw, 420px)',
    whiteSpace: 'pre-wrap',
    font: '10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#f4f4f4',
    background: 'rgba(8, 8, 10, 0.78)',
    borderLeft: '2px solid #ff4e96',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(box);

  const context = gl.getContext();
  const debug = context.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER));

  let frames = 0;
  let cpuTotal = 0;
  let cpuWorst = 0;
  let intervalWorst = 0;
  let since = performance.now();

  return {
    frame(cpuMs: number, intervalMs: number) {
      frames += 1;
      cpuTotal += cpuMs;
      cpuWorst = Math.max(cpuWorst, cpuMs);
      intervalWorst = Math.max(intervalWorst, intervalMs);
      const now = performance.now();
      if (now - since < 500) return;
      const fps = (frames * 1000) / (now - since);
      const size = gl.getDrawingBufferSize(scratch);
      box.textContent = [
        `${fps.toFixed(0)} fps · cap ${governor.cap || 'off'} · worst gap ${intervalWorst.toFixed(0)} ms`,
        `cpu ${(cpuTotal / frames).toFixed(1)} ms avg · ${cpuWorst.toFixed(1)} worst`,
        `${size.x}×${size.y} · scale ${governor.scale.toFixed(2)} of ${PERFORMANCE.dpr.toFixed(2)}× · ${governor.aa ? 'SMAA' : governor.fxaa ? 'FXAA' : 'no AA'}`,
        `${governor.lastDecision}`,
        `tier ${PERFORMANCE.quality} · ${QUALITY_REASON}`,
        gpu,
      ].join('\n');
      frames = 0;
      cpuTotal = 0;
      cpuWorst = 0;
      intervalWorst = 0;
      since = now;
    },
    dispose() {
      box.remove();
    },
  };
}

const scratch = new Vector2();
