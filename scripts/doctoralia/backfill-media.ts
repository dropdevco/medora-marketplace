/**
 * Extract gallery photos, website and social links from Doctoralia profile
 * pages into out/media.jsonl.
 *
 *   npx tsx scripts/doctoralia/backfill-media.ts --offline            # cache only, zero requests
 *   npx tsx scripts/doctoralia/backfill-media.ts --offline --limit=25 # sample
 *   npx tsx scripts/doctoralia/backfill-media.ts                      # cache first, live fetch for misses
 *   npx tsx scripts/doctoralia/backfill-media.ts --refetch            # ignore cache + resume state (network!)
 *
 * Resumable: ids already in media.jsonl are skipped (unless --refetch).
 * Live fetches (only for pages missing from .cache/) go through politeGet:
 * 2.5-4s apart, single-threaded, no proxies. Same ToS caveats as README.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { CACHE_DIR, INDEX_FILE, OUT_DIR, PROFILES_FILE } from './config';
import { politeGet, stats } from './http';
import { extractMedia, type Media } from './parse-media';

export const MEDIA_FILE = path.join(OUT_DIR, 'media.jsonl');

export interface MediaRecord extends Media {
  doctoraliaId: string;
  url: string;
  /** 'cache' = read from .cache/, 'live' = fetched now, 'missing' = 404/unavailable. */
  from: 'cache' | 'live' | 'missing';
  scrapedAt: string;
}

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const refetch = args.includes('--refetch');
const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || Infinity;

/** Same key http.ts uses, so a page fetched by scrape.ts is found here. */
function readCachedPage(url: string): string | null {
  const hash = crypto.createHash('sha1').update(url).digest('hex');
  const file = path.join(CACHE_DIR, hash.slice(0, 2), `${hash}.gz`);
  if (!fs.existsSync(file)) return null;
  try {
    return zlib.gunzipSync(fs.readFileSync(file)).toString('utf-8');
  } catch {
    return null;
  }
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const out: T[] = [];
  for (const line of fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)) {
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // half-written line from an interrupted run
    }
  }
  return out;
}

export function loadMediaRecords(): Map<string, MediaRecord> {
  const m = new Map<string, MediaRecord>();
  for (const r of readJsonl<MediaRecord>(MEDIA_FILE)) m.set(r.doctoraliaId, r);
  return m;
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // One target per Doctoralia id. profiles.jsonl is the authority on which
  // entities we hold; index.jsonl backs it up.
  const targets = new Map<string, string>();
  for (const p of readJsonl<{ doctoraliaId: string; url: string }>(PROFILES_FILE)) targets.set(p.doctoraliaId, p.url);
  for (const e of readJsonl<{ doctoraliaId: string; url: string }>(INDEX_FILE)) {
    if (!targets.has(e.doctoraliaId)) targets.set(e.doctoraliaId, e.url);
  }

  const done = refetch ? new Map<string, MediaRecord>() : loadMediaRecords();
  const todo = [...targets].filter(([id]) => !done.has(id)).slice(0, limit === Infinity ? undefined : limit);

  console.log(
    `\nMedia backfill: ${targets.size} profiles known, ${done.size} already done, ${todo.length} to do` +
      `${offline ? ' (offline: cache only, no requests)' : ''}${refetch ? ' (refetch)' : ''}\n`,
  );

  const out = fs.createWriteStream(MEDIA_FILE, { flags: 'a' });
  let n = 0;
  let skippedNoCache = 0;
  const cov = { gallery: 0, website: 0, any: 0, socials: {} as Record<string, number> };

  for (const [doctoraliaId, url] of todo) {
    let html: string | null = null;
    let from: MediaRecord['from'] = 'cache';

    if (!refetch) html = readCachedPage(url);
    if (html === null) {
      if (offline) {
        skippedNoCache++;
        continue; // nothing recorded, so a later online run picks it up
      }
      html = await politeGet(url, { useCache: !refetch ? true : false });
      from = html === null ? 'missing' : 'live';
      // politeGet with useCache:false still writes the cache; refetch therefore refreshes it.
    }

    const media: Media = html === null ? { galleryUrls: [], socials: {} } : extractMedia(html);
    const rec: MediaRecord = { doctoraliaId, url, ...media, from, scrapedAt: new Date().toISOString() };
    out.write(JSON.stringify(rec) + '\n');

    n++;
    if (media.galleryUrls.length) cov.gallery++;
    if (media.website) cov.website++;
    for (const k of Object.keys(media.socials)) cov.socials[k] = (cov.socials[k] ?? 0) + 1;
    if (media.galleryUrls.length || media.website || Object.keys(media.socials).length) cov.any++;
    if (n % 100 === 0) process.stdout.write(`\r  ${n}/${todo.length}`);
  }
  await new Promise<void>((r) => out.end(r));

  console.log(`\r  processed ${n}${skippedNoCache ? `, ${skippedNoCache} skipped (not in cache, --offline)` : ''}`);
  console.log(`  with gallery photos: ${cov.gallery}`);
  console.log(`  with website:        ${cov.website}`);
  console.log(`  socials:             ${JSON.stringify(cov.socials)}`);
  console.log(`  with anything:       ${cov.any}`);
  console.log(`  network: fetched ${stats.fetched}, retries ${stats.retries}, not found ${stats.notFound}, failed ${stats.failed}`);
  console.log(`  -> ${MEDIA_FILE}\n`);
}

// Only run when executed directly, so load-media.ts can import loadMediaRecords.
if (process.argv[1] && /backfill-media\.[tj]s$/.test(process.argv[1])) {
  run().catch((err) => {
    console.error('\nfatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
