import grotesk from '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url';

export type ExportStep = 'create' | 'write' | 'open';

const STEPS: { id: ExportStep; label: string; line: string; at: number }[] = [
  { id: 'create', label: 'Project', line: 'Making a new Audiotool project…', at: 0.2 },
  { id: 'write', label: 'Track', line: 'Writing your room’s track into it…', at: 0.8 },
  { id: 'open', label: 'Studio', line: 'Opening it in Audiotool…', at: 1 },
];

const STYLE = `
@font-face{font-family:'Space Grotesk';font-weight:300 700;font-display:block;src:url('${new URL(grotesk, location.href).href}') format('woff2-variations')}
:root{--bg:#0e0e10;--ink:#f4f2ee;--dim:#908f98;--faint:#5c5b64;--line:rgba(244,242,238,.14);--soft:rgba(244,242,238,.07);--accent:#ff4e96;color-scheme:dark}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--ink);overflow:hidden;cursor:progress;
font-family:'Space Grotesk',ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-align:center}
.bd{position:fixed;inset:0;pointer-events:none}
.bd i{position:absolute;inset:-8%;background-image:radial-gradient(circle,rgba(244,242,238,.085) 1px,transparent 1px);background-size:34px 34px;animation:drift 24s linear infinite}
.bd b{position:absolute;border:1px solid var(--soft);border-radius:50%}
.bd b:nth-of-type(1){width:78vmax;height:78vmax;right:-30vmax;top:-26vmax;animation:breathe 4s ease-in-out infinite}
.bd b:nth-of-type(2){width:46vmax;height:46vmax;left:-18vmax;bottom:-14vmax;border-color:rgba(255,78,150,.16);animation:breathe 4s ease-in-out -2s infinite}
@keyframes drift{to{transform:translate(34px,34px)}}
@keyframes breathe{50%{transform:scale(1.03)}}
main{position:relative;display:grid;justify-items:center;width:min(100%,720px);animation:rise .4s cubic-bezier(.2,.8,.25,1) both}
@keyframes rise{from{opacity:0;transform:translateY(12px)}}
.mark{position:relative;width:clamp(112px,30vw,164px);aspect-ratio:1;margin-bottom:clamp(22px,5vw,34px)}
.sleeve{position:relative;width:clamp(132px,36vw,196px);aspect-ratio:1;margin-bottom:clamp(22px,5vw,34px);transform:translateX(-18%)}
.sleeve>img{position:relative;display:block;width:100%;height:100%;border-radius:3px;box-shadow:0 22px 60px rgba(0,0,0,.6)}
.sleeve .vinyl{left:30%;top:4%;width:92%;animation:spin 1.8s linear infinite,slide .8s cubic-bezier(.2,.8,.25,1) both}
@keyframes slide{from{left:4%}}
.mark>svg{display:block;width:100%;height:100%}
.vinyl{position:absolute;left:25.39%;top:35.94%;width:49.22%;aspect-ratio:1;animation:spin 1.8s linear infinite}
.vinyl svg{display:block;width:100%;height:100%}
@keyframes spin{to{transform:rotate(360deg)}}
.kicker,.steps{font-size:11px;font-weight:700;letter-spacing:.24em;text-transform:uppercase}
.kicker{margin:0 0 clamp(12px,3vw,18px);color:var(--dim)}
.kicker em{font-style:normal;color:var(--accent)}
h1{margin:0;font-size:clamp(2.4rem,9vw,5.25rem);font-weight:700;line-height:.9;letter-spacing:-.04em;text-transform:uppercase;text-wrap:balance}
h1 span{color:var(--accent)}
.bar{position:relative;width:min(100%,420px);height:2px;margin-top:clamp(26px,6vw,40px);background:var(--line);border-radius:2px;overflow:hidden}
.bar i{position:absolute;inset:0;background:var(--accent);transform-origin:left;transform:scaleX(0);transition:transform .6s cubic-bezier(.2,.8,.25,1)}
.bar b{position:absolute;top:0;bottom:0;width:14%;background:rgba(244,242,238,.45);animation:sweep 1.4s cubic-bezier(.6,0,.4,1) infinite}
@keyframes sweep{from{transform:translateX(-100%)}to{transform:translateX(720%)}}
.steps{display:flex;flex-wrap:wrap;justify-content:center;gap:10px clamp(14px,4vw,26px);margin:16px 0 0;padding:0;list-style:none}
.steps li{display:inline-flex;align-items:center;gap:8px;color:var(--faint);transition:color .3s}
.steps li::before{content:'';width:6px;height:6px;border-radius:50%;border:1px solid currentColor;transition:background-color .3s,border-color .3s}
.steps li.now{color:var(--ink)}
.steps li.now::before{border-color:var(--accent);animation:beat .5s ease-out infinite alternate}
.steps li.done{color:var(--dim)}
.steps li.done::before{background:var(--accent);border-color:var(--accent)}
@keyframes beat{to{transform:scale(1.6)}}
.line{min-height:1.6em;margin:22px 0 0;font-size:15px;font-weight:500;color:var(--dim)}
.name{min-height:1.4em;margin:6px 0 0;font-size:15px;font-weight:700;color:var(--ink)}
body.stopped{cursor:default}
body.stopped .vinyl,body.stopped .bar b,body.stopped .steps li.now::before{animation:none}
body.stopped .bar b{display:none}
body.stopped .line{max-width:34em;color:var(--ink)}
body.failed .bar i{background:var(--faint)}
body.failed .steps li.now{color:var(--accent)}
body.failed .steps li.now::before{background:var(--accent)}
@media (prefers-reduced-motion:reduce){.vinyl{animation-duration:7.2s}.bd i,.bd b,.bar b,.steps li.now::before,main{animation:none}}
`;

const MARK = `<div class="mark" aria-hidden="true">
<svg viewBox="0 0 128 128"><g transform="translate(6.4 6.4) scale(0.9)">
<path d="M64 121C38 121 19 103 19 79c0-18 8-32 22-40l-6-22C32 7 36 3 43 5c8 2 13 16 15 29 4-1 8-1 12 0C74 21 81 7 90 5c7-2 12 3 9 12L88 40c13 8 21 22 21 39 0 24-19 42-45 42Z" fill="#f4f2ee"/>
<path d="M42 14c5 5 8 15 9 26l-7 4c-1-13-4-24-2-30Zm51 0c-5 5-8 15-10 27l-7-4c4-12 11-23 17-23Z" fill="#ff4e96"/>
</g></svg>
<div class="vinyl"><svg viewBox="0 0 70 70">
<circle cx="35" cy="35" r="35" fill="#22232b"/>
<path d="M8 36c0-15 12-27 27-28v5C23 14 13 24 13 36Zm54 0c0 15-12 27-27 28v-5c12-1 22-11 22-23Z" fill="#50505b"/>
<circle cx="35" cy="35" r="13" fill="#ff4e96"/><circle cx="35" cy="35" r="3.5" fill="#f4f2ee"/>
</svg></div></div>`;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sending to Audiotool…</title>
<link rel="icon" href="${new URL('/favicon.svg', location.href).href}" type="image/svg+xml">
<style>${STYLE}</style></head>
<body><div class="bd" aria-hidden="true"><i></i><b></b><b></b></div>
<main role="status" aria-live="polite">${MARK}
<p class="kicker">Sending to <em>Audiotool</em></p>
<h1>Keep the Beat<span>.</span></h1>
<div class="bar" aria-hidden="true"><i></i><b></b></div>
<ol class="steps">${STEPS.map((s) => `<li data-step="${s.id}">${s.label}</li>`).join('')}</ol>
<p class="line"></p><p class="name"></p>
</main></body></html>`;

export type ExportTab = {
  step(step: ExportStep): void;
  cover(url: string): void;
  name(displayName: string): void;
  go(url: string): void;
  fail(): void;
  close(): void;
};

export function openExportTab(): ExportTab | null {
  const tab = window.open('', '_blank');
  if (!tab) return null;
  tab.opener = null;
  tab.document.write(PAGE);
  tab.document.close();

  const edit = (change: (doc: Document) => void) => {
    try { if (!tab.closed) change(tab.document); } catch {}
  };

  const api: ExportTab = {
    step(step) {
      edit((doc) => {
        const at = STEPS.findIndex((s) => s.id === step);
        doc.querySelectorAll<HTMLElement>('.steps li').forEach((li, index) => {
          li.className = index < at ? 'done' : index === at ? 'now' : '';
        });
        const bar = doc.querySelector<HTMLElement>('.bar i');
        if (bar) bar.style.transform = `scaleX(${STEPS[at].at})`;
        const line = doc.querySelector('.line');
        if (line) line.textContent = STEPS[at].line;
      });
    },
    cover(url) {
      edit((doc) => {
        const mark = doc.querySelector('.mark');
        if (!mark) return;
        const sleeve = doc.createElement('div');
        sleeve.className = 'sleeve';
        sleeve.setAttribute('aria-hidden', 'true');
        const vinyl = mark.querySelector('.vinyl');
        if (vinyl) sleeve.append(vinyl);
        const image = doc.createElement('img');
        image.src = url;
        image.alt = '';
        sleeve.append(image);
        mark.replaceWith(sleeve);
      });
    },
    name(displayName) {
      edit((doc) => {
        const name = doc.querySelector('.name');
        if (name) name.textContent = `“${displayName}”`;
      });
    },
    go(url) {
      api.step('open');
      tab.location.replace(url);
    },
    fail() {
      edit((doc) => {
        doc.body.classList.add('stopped', 'failed');
        doc.title = 'Not sent';
        const kicker = doc.querySelector('.kicker');
        if (kicker) kicker.innerHTML = 'Not sent to <em>Audiotool</em>';
        const line = doc.querySelector('.line');
        if (line) line.textContent = 'Something went wrong while sending the show.';
        const name = doc.querySelector('.name');
        if (name) name.textContent = 'You can close this tab and try again from the show.';
      });
    },
    close() {
      tab.close();
    },
  };
  api.step('create');
  return api;
}
