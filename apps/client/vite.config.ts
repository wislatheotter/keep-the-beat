import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|glb|gltf|bin|wasm|txt|xml)$/;
const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

function precompress(): Plugin {
  let outDir = 'dist';
  return {
    name: 'keep-the-beat:precompress',
    apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const files: string[] = [];
      const walk = async (dir: string) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (COMPRESSIBLE.test(entry.name)) files.push(full);
        }
      };
      await walk(outDir);
      await Promise.all(files.map(async (file) => {
        if ((await stat(file)).size < 1024) return;
        const raw = await readFile(file);
        const [br, gz] = await Promise.all([
          brotli(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }),
          gzipAsync(raw, { level: 9 }),
        ]);
        if (br.length < raw.length * 0.9) await writeFile(`${file}.br`, br);
        if (gz.length < raw.length * 0.9) await writeFile(`${file}.gz`, gz);
      }));
    },
  };
}

const GSTATIC_DRACO = /https:\/\/www\.gstatic\.com\/draco\/[^'"`]*/g;

function localDraco(): Plugin {
  return {
    name: 'keep-the-beat:local-draco',
    apply: 'build',
    transform(code) {
      if (!code.includes('gstatic.com/draco')) return null;
      return { code: code.replace(GSTATIC_DRACO, '/draco/'), map: null };
    },
    generateBundle(_options, bundle) {
      for (const [name, file] of Object.entries(bundle)) {
        const text = file.type === 'chunk' ? file.code : typeof file.source === 'string' ? file.source : '';
        if (!name.endsWith('.map') && text.includes('gstatic.com')) this.error(`${name} still points at gstatic.com`);
      }
    },
  };
}

const MEASURING = process.env.VITE_DEV_HANDLE === '1';

const GLSL = /\b(?:gl_[A-Za-z]+|uniform\s|varying\s|attribute\s|void\s+main|vec[234]\s*\(|#include\s*<|#define\s)/;
const HOLE = '\u0000';

function stripGlslComments(text: string): string | null {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '/' && text[i + 1] === '/') {
      let end = i + 2;
      while (end < text.length && text[end] !== '\n' && !(text[end] === '\\' && text[end + 1] === 'n')) end += 1;
      if (text.slice(i, end).includes(HOLE)) return null;
      i = end - 1;
      continue;
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0 || text.slice(i, end).includes(HOLE)) return null;
      i = end + 1;
      continue;
    }
    out += text[i];
  }
  return out.replace(/[ \t]+(?=\r?\n)/g, '').replace(/\n(?:[ \t]*\r?\n)+/g, '\n');
}

function shaderComments(): Plugin {
  type Node = { type?: string; start: number; end: number; [key: string]: unknown };
  type Quasi = Node & { value: { raw: string } };
  return {
    name: 'keep-the-beat:shader-comments',
    apply: 'build',
    enforce: 'post',
    transform(code, id) {
      if (!/[\\/]apps[\\/]client[\\/]src[\\/]/.test(id) || !GLSL.test(code)) return null;
      const edits: { start: number; end: number; text: string }[] = [];
      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(visit); return; }
        const current = node as Node;
        if (current.type === 'TemplateLiteral') {
          const quasis = current.quasis as Quasi[];
          const joined = quasis.map((quasi) => quasi.value.raw).join(HOLE);
          const stripped = GLSL.test(joined) && quasis.every((quasi) => code.slice(quasi.start, quasi.end) === quasi.value.raw)
            ? stripGlslComments(joined)
            : null;
          const parts = stripped?.split(HOLE);
          if (parts && parts.length === quasis.length) {
            quasis.forEach((quasi, index) => {
              if (parts[index] !== quasi.value.raw) edits.push({ start: quasi.start, end: quasi.end, text: parts[index]! });
            });
          }
        }
        for (const value of Object.values(current)) if (value && typeof value === 'object') visit(value);
      };
      visit(this.parse(code));
      if (edits.length === 0) return null;
      let result = code;
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
      }
      return { code: result, map: null };
    },
  };
}

const GAME_ROOTS = /[\\/]src[\\/](?:Game\.tsx|runtime[\\/](?:Local|Socket)GameRuntime\.ts|audio[\\/]LoopEngine\.ts)$/;

function gameCode(): Plugin {
  return {
    name: 'keep-the-beat:game-code',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        const bundle = context.bundle;
        if (!bundle) return html;
        const chunks = Object.values(bundle).filter((file) => file.type === 'chunk');
        const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
        const files = new Set<string>();
        const visit = (name: string) => {
          const chunk = byName.get(name);
          if (!chunk || chunk.isEntry || files.has(name)) return;
          files.add(name);
          for (const css of (chunk as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss ?? []) files.add(css);
          for (const next of [...chunk.imports, ...chunk.dynamicImports]) visit(next);
        };
        for (const chunk of chunks) if (chunk.facadeModuleId && GAME_ROOTS.test(chunk.facadeModuleId)) visit(chunk.fileName);
        const list = [...files].map((file) => `/${file}`).join(' ');
        return html.replace('</head>', `<meta name="ktb-game-code" content="${list}" />\n</head>`);
      },
    },
  };
}

type PackageNotice = { name: string; version: string; license: string; url: string; text: string };

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i;

function packageRoot(id: string): string | null {
  const clean = id.replace(/^\0/, '').split('?')[0]!.replace(/\\/g, '/');
  const at = clean.lastIndexOf('/node_modules/');
  if (at < 0) return null;
  const rest = clean.slice(at + '/node_modules/'.length).split('/');
  const name = rest[0]!.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]!;
  return `${clean.slice(0, at)}/node_modules/${name}`;
}

function describePackage(root: string): PackageNotice | null {
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      name: string; version: string; license?: string | { type?: string }; homepage?: string; repository?: string | { url?: string };
    };
    const license = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type ?? 'see package';
    const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url ?? '';
    const url = (manifest.homepage || repository.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://')
      || `https://www.npmjs.com/package/${manifest.name}`);
    const file = readdirSync(root).find((entry) => LICENSE_FILE.test(entry));
    const text = file ? readFileSync(path.join(root, file), 'utf8').trim() : `Licensed under ${license}.`;
    return { name: manifest.name, version: manifest.version, license, url, text };
  } catch {
    return null;
  }
}

function listNotices(roots: Iterable<string>) {
  const notices = [...new Set(roots)].map(describePackage).filter((notice): notice is PackageNotice => !!notice);
  return notices.sort((a, b) => a.name.localeCompare(b.name));
}

function noticesText(notices: PackageNotice[]) {
  return notices.map((notice) => `${notice.name} ${notice.version} (${notice.license})\n${notice.url}\n\n${notice.text}\n`)
    .join(`\n${'-'.repeat(72)}\n\n`);
}

const shippedPackages = new Set<string>();

function recordPackages(bundle: Record<string, { type: string; moduleIds?: string[] }>) {
  for (const file of Object.values(bundle)) {
    if (file.type !== 'chunk') continue;
    for (const id of file.moduleIds ?? []) {
      const root = packageRoot(id);
      if (root) shippedPackages.add(root);
    }
  }
}

function collectPackages(): Plugin {
  return {
    name: 'keep-the-beat:collect-packages',
    apply: 'build',
    generateBundle(_options, bundle) { recordPackages(bundle); },
  };
}

function thirdPartyLicenses(): Plugin {
  return {
    name: 'keep-the-beat:third-party-licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      recordPackages(bundle);
      const notices = listNotices(shippedPackages);
      const summary = notices.map(({ name, version, license, url }) => ({ name, version, license, url }));
      this.emitFile({ type: 'asset', fileName: 'licenses/third-party.json', source: JSON.stringify(summary) });
      this.emitFile({ type: 'asset', fileName: 'licenses/third-party.txt', source: noticesText(notices) });
    },
  };
}

function devLicenses(): Plugin {
  const RUNTIME = /^(?!@types\/|@vitejs\/|typescript$|vite$|@loop\/)/;
  return {
    name: 'keep-the-beat:dev-licenses',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url !== '/licenses/third-party.json' && url !== '/licenses/third-party.txt') { next(); return; }
        const manifest = JSON.parse(readFileSync(path.join(server.config.root, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
        const roots = Object.keys(manifest.devDependencies ?? {}).filter((name) => RUNTIME.test(name))
          .map((name) => [server.config.root, path.resolve(server.config.root, '../..')]
            .map((base) => path.join(base, 'node_modules', name)).find((root) => existsSync(root)))
          .filter((root): root is string => !!root);
        const notices = listNotices(roots);
        const json = url.endsWith('.json');
        res.setHeader('Content-Type', json ? 'application/json' : 'text/plain; charset=utf-8');
        res.end(json ? JSON.stringify(notices.map(({ name, version, license, url: home }) => ({ name, version, license, url: home }))) : noticesText(notices));
      });
    },
  };
}

function htmlComments(): Plugin {
  return {
    name: 'keep-the-beat:html-comments',
    apply: 'build',
    transformIndexHtml: (html) => html.replace(/<!--[\s\S]*?-->\s*/g, ''),
  };
}

const OUTPUT_COMMENTS = { legal: true, annotation: false, jsdoc: false } as const;
const QUIET = { manualPureFunctions: ['console.log', 'console.info', 'console.debug'] };

export default defineConfig({
  plugins: [react(), localDraco(), shaderComments(), htmlComments(), gameCode(), thirdPartyLicenses(), devLicenses(), precompress()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/live': {
        target: 'http://127.0.0.1:3001',
        ws: true,
      },
      '/api': 'http://127.0.0.1:3001',
    },
  },
  preview: {
    host: true,
    proxy: {
      '/live': { target: 'http://127.0.0.1:3001', ws: true },
      '/api': 'http://127.0.0.1:3001',
    },
  },
  worker: {
    format: 'es',
    plugins: () => [collectPackages()],
    rolldownOptions: { treeshake: QUIET, output: { comments: OUTPUT_COMMENTS } },
  },
  build: {
    outDir: 'dist',
    sourcemap: MEASURING,
    rolldownOptions: {
      treeshake: QUIET,
      output: {
        comments: OUTPUT_COMMENTS,
        keepNames: true,
      },
    },
  },
});
