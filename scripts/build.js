// Assemble the deployable static site into `site/`.
//
// The app has no bundler: `index.html` loads its ES modules straight from
// `src/` with relative paths. So a "build" is just collecting the runtime files
// (the entry HTML plus `src/`) into one directory that can be served from any
// base path. Everything else in the repo — tests, docs, tooling — stays out.

import { rm, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../site', import.meta.url));

// Runtime files the served page actually needs, relative to the repo root.
const ASSETS = ['index.html', 'src'];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const asset of ASSETS) {
  await cp(new URL(asset, `file://${ROOT}`), new URL(asset, `file://${OUT}/`), {
    recursive: true,
  });
}

console.log(`Built site/ → ${ASSETS.join(', ')}`);
