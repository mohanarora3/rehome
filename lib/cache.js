// Qloo response cache: memory first, then one small JSON file per request on disk.
// Each Qloo response is fetched once per URL, so what-if changes never re-call Qloo.
// (An older single-file cache, .cache/qloo-cache.json, is read once if present.)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.VERCEL ? '/tmp/qloo-cache' : path.join(process.cwd(), '.cache', 'qloo');
const legacy = path.join(process.cwd(), '.cache', 'qloo-cache.json');
const TTL_MS = 1000 * 60 * 60 * 24 * 3;
const mem = new Map();
let legacyLoaded = false;

const fileFor = (key) => path.join(dir, crypto.createHash('sha1').update(key).digest('hex') + '.json');

function loadLegacy() {
  if (legacyLoaded) return;
  legacyLoaded = true;
  try {
    const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    for (const [k, v] of Object.entries(old)) mem.set(k, v);
  } catch { /* no legacy cache */ }
}

export function cacheGet(key) {
  loadLegacy();
  let hit = mem.get(key);
  if (!hit) {
    try { hit = JSON.parse(fs.readFileSync(fileFor(key), 'utf8')); mem.set(key, hit); } catch { return null; }
  }
  if (Date.now() - hit.t > TTL_MS) return null;
  return hit.v;
}

export function cacheSet(key, value) {
  const entry = { t: Date.now(), v: value };
  mem.set(key, entry);
  fs.promises.mkdir(dir, { recursive: true })
    .then(() => fs.promises.writeFile(fileFor(key), JSON.stringify(entry)))
    .catch(() => { /* read-only disk is fine */ });
}
