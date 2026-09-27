import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { HttpRequest, HttpResponse, TemplatedApp } from 'uWebSockets.js';
import { LIVE_PATH } from '@loop/shared/wire';

export const PUBLIC_HOST = (process.env.PUBLIC_HOST || 'keepthebeat.games').toLowerCase();

const AUDIOTOOL_RUNTIME = 'https://cdn.audiotool.com/website-assets/document-service/';

const CONTENT_SECURITY_POLICY = [
  `script-src 'self' 'wasm-unsafe-eval' ${AUDIOTOOL_RUNTIME}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS: [string, string][] = [
  ['Content-Security-Policy', CONTENT_SECURITY_POLICY],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

type Asset = { body: Buffer; br?: Buffer; gzip?: Buffer; type: string; cache: string; etag: string };

function cacheFor(urlPath: string) {
  return urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate';
}

function loadSite(root: string) {
  const assets = new Map<string, Asset>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(br|gz)$/.test(entry.name)) continue;
      const urlPath = '/' + path.relative(root, full).split(path.sep).join('/');
      const body = fs.readFileSync(full);
      const read = (suffix: string) => (fs.existsSync(full + suffix) ? fs.readFileSync(full + suffix) : undefined);
      assets.set(urlPath, {
        body,
        br: read('.br'),
        gzip: read('.gz'),
        type: TYPES[path.extname(entry.name).toLowerCase()] ?? 'application/octet-stream',
        cache: urlPath === '/index.html' ? 'no-cache' : cacheFor(urlPath),
        etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 22)}"`,
      });
    }
  };
  walk(root);
  return assets;
}

function respond(res: HttpResponse, status: string, headers: [string, string][], body: Buffer | string = '', head = false) {
  if (res.aborted) return;
  res.cork(() => {
    res.writeStatus(status);
    for (const [key, value] of SECURITY_HEADERS) res.writeHeader(key, value);
    for (const [key, value] of headers) res.writeHeader(key, value);
    const data = typeof body === 'string' ? Buffer.from(body) : body;
    if (head) { res.endWithoutBody(data.length); return; }
    const start = res.getWriteOffset();
    const [ok, done] = res.tryEnd(data, data.length);
    if (ok || done) return;
    res.onWritable((offset) => {
      const [sent] = res.tryEnd(data.subarray(offset - start), data.length);
      return sent;
    });
  });
}

const json = (value: unknown) => JSON.stringify(value);
const namesAFile = (urlPath: string) => /\.[A-Za-z0-9]+$/.test(urlPath);

export function mountSite(app: TemplatedApp, clientDist: string, publicConfig: () => object) {
  const assets = fs.existsSync(clientDist) ? loadSite(clientDist) : new Map<string, Asset>();
  const index = assets.get('/index.html');

  app.any('/*', (res: HttpResponse, req: HttpRequest) => {
    res.onAborted(() => { res.aborted = true; });
    const method = req.getMethod();
    const url = req.getUrl();
    const query = req.getQuery();
    const host = req.getHeader('host').toLowerCase();
    const proto = req.getHeader('x-forwarded-proto').split(',')[0]!.trim();
    const hsts: [string, string][] = proto === 'https' ? [['Strict-Transport-Security', 'max-age=31536000']] : [];

    if (proto === 'http' || host === `www.${PUBLIC_HOST}`) {
      const target = `https://${host === `www.${PUBLIC_HOST}` ? PUBLIC_HOST : host || PUBLIC_HOST}${url}${query ? `?${query}` : ''}`;
      respond(res, '308 Permanent Redirect', [['Location', target]]);
      return;
    }

    if (url === '/api/health' || url === '/api/config') {
      respond(res, '200 OK', [...hsts, ['Content-Type', 'application/json'], ['Cache-Control', 'no-store']],
        json(url === '/api/health' ? { ok: true } : publicConfig()));
      return;
    }
    if (url === '/api' || url.startsWith('/api/')) {
      respond(res, '404 Not Found', [...hsts, ['Content-Type', 'application/json']], json({ ok: false }));
      return;
    }
    if (method !== 'get' && method !== 'head') {
      respond(res, '404 Not Found', [...hsts, ['Content-Type', 'text/plain']], 'Not found');
      return;
    }
    if (!index) {
      respond(res, '200 OK', [['Content-Type', 'text/plain']], 'Client build not found. Run npm run build, or use npm run dev for local development.');
      return;
    }

    const asset = assets.get(url) ?? (namesAFile(url) || url.startsWith(LIVE_PATH) ? undefined : index);
    if (!asset) {
      respond(res, '404 Not Found', [...hsts, ['Content-Type', 'text/plain']], 'Not found');
      return;
    }

    const headers: [string, string][] = [...hsts, ['Content-Type', asset.type], ['Cache-Control', asset.cache], ['ETag', asset.etag]];
    if (req.getHeader('if-none-match') === asset.etag) {
      respond(res, '304 Not Modified', headers);
      return;
    }
    const accepts = req.getHeader('accept-encoding');
    const encoding = asset.br && /\bbr\b/.test(accepts) ? 'br' : asset.gzip && /\bgzip\b/.test(accepts) ? 'gzip' : null;
    if (asset.br || asset.gzip) headers.push(['Vary', 'Accept-Encoding']);
    if (encoding) headers.push(['Content-Encoding', encoding]);
    respond(res, '200 OK', headers, encoding ? asset[encoding]! : asset.body, method === 'head');
  });
}
