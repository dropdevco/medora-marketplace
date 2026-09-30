/**
 * Copy website / socials / galleryUrls from out/media.jsonl onto `providers`.
 *
 *   npx tsx scripts/doctoralia/load-media.ts           # DRY RUN (default): prints counts, writes nothing
 *   npx tsx scripts/doctoralia/load-media.ts --apply   # performs the updates
 *
 * Fill-only rules, so nothing an owner or an earlier pass set is overwritten:
 *   - website:     only when currently empty
 *   - socials:     merged; only keys that are currently missing are added
 *   - galleryUrls: only when currently empty
 *   - rows with source = 'self' (owner-managed) are never touched
 * Rows are matched on providers."doctoraliaId". Requires VITE_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (env, .env.local or .env). Keys are never printed.
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { loadMediaRecords } from './backfill-media';

const apply = process.argv.includes('--apply');
const BATCH = 10; // concurrent single-row updates per round

function loadEnv() {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      out[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

interface Row {
  id: string;
  name: string;
  source: string | null;
  doctoraliaId: string | null;
  website: string | null;
  socials: Record<string, string> | null;
  galleryUrls: string[] | null;
}

async function run() {
  const env = loadEnv();
  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  }
  const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const media = loadMediaRecords();
  if (!media.size) throw new Error('out/media.jsonl is empty or missing - run backfill-media.ts first');

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('providers')
      .select('id,name,source,"doctoraliaId",website,socials,"galleryUrls"')
      .not('doctoraliaId', 'is', null)
      .range(from, from + 999);
    if (error) throw new Error(`could not read providers: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }

  console.log(`\nload-media ${apply ? 'APPLY' : 'DRY RUN'}: ${rows.length} Doctoralia-linked providers, ${media.size} media records\n`);

  const count = { noRecord: 0, selfSkipped: 0, unchanged: 0, website: 0, gallery: 0, rowsUpdated: 0 };
  const socialAdds: Record<string, number> = {};
  const updates: { id: string; name: string; patch: Record<string, unknown> }[] = [];

  for (const r of rows) {
    const rec = r.doctoraliaId ? media.get(r.doctoraliaId) : undefined;
    if (!rec) {
      count.noRecord++;
      continue;
    }
    if (r.source === 'self') {
      count.selfSkipped++;
      continue;
    }

    const patch: Record<string, unknown> = {};

    if (rec.website && !(r.website ?? '').trim()) {
      patch.website = rec.website;
      count.website++;
    }

    const cur = r.socials ?? {};
    const merged: Record<string, string> = { ...cur };
    let added = 0;
    for (const [k, v] of Object.entries(rec.socials)) {
      if (v && !(cur[k] ?? '').trim()) {
        merged[k] = v;
        socialAdds[k] = (socialAdds[k] ?? 0) + 1;
        added++;
      }
    }
    if (added) patch.socials = merged;

    if (rec.galleryUrls.length && !(r.galleryUrls?.length)) {
      patch.galleryUrls = rec.galleryUrls;
      count.gallery++;
    }

    if (!Object.keys(patch).length) {
      count.unchanged++;
      continue;
    }
    updates.push({ id: r.id, name: r.name, patch });
  }

  console.log(`  providers with a media record:      ${rows.length - count.noRecord}`);
  console.log(`  skipped (source = 'self'):          ${count.selfSkipped}`);
  console.log(`  nothing to add:                     ${count.unchanged}`);
  console.log(`  rows that ${apply ? 'will be' : 'would be'} updated:        ${updates.length}`);
  console.log(`    website filled:                   ${count.website}`);
  console.log(`    galleryUrls filled:               ${count.gallery}`);
  console.log(`    socials keys added:               ${JSON.stringify(socialAdds)}`);

  if (!apply) {
    console.log('\n  Dry run - nothing written. Re-run with --apply to update.\n');
    return;
  }

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map(async (u) => {
        const { error } = await supabase.from('providers').update(u.patch).eq('id', u.id);
        if (error) console.error(`  x ${u.name}: ${error.message}`);
        return !error;
      }),
    );
    for (const good of results) good ? ok++ : failed++;
    process.stdout.write(`\r  ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }
  console.log(`\n  updated ${ok}, failed ${failed}\n`);
  if (failed) process.exit(1);
}

run().catch((err) => {
  console.error('\nfatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
