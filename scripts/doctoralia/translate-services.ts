/**
 * Translate published service names into English, once, and cache the result
 * on the row itself.
 *
 *   npx tsx scripts/doctoralia/translate-services.ts              # dry run
 *   npx tsx scripts/doctoralia/translate-services.ts --commit
 *
 * Needs GOOGLE_TRANSLATE_API_KEY in .env.local — a *Cloud Translation API*
 * key, which is a different product from the Maps/Places key this project
 * already has. In Google Cloud Console: APIs & Services -> Library -> enable
 * "Cloud Translation API" (same project as the Maps key is fine) -> then
 * Credentials -> Create Credentials -> API key. Restrict it to the
 * Translation API specifically before saving it anywhere.
 *
 * Unlike reviews (see src/hooks/useGoogleReviews.ts), Google does not
 * auto-translate arbitrary text for free — service names need this separate,
 * billed API. The saving grace is volume: run in dry-run mode against the
 * live directory, this reports a few hundred KB of *unique* text (most
 * providers share the same handful of generic service names — "Consulta
 * general", "Limpieza dental" — so this only ever pays to translate each
 * distinct name once, not once per provider). At Cloud Translation's Basic
 * tier (~$20 per million characters, first 500K characters/month free) the
 * one-time run this directory needs today costs on the order of a few
 * dollars, likely nothing once the free tier is applied. Re-running later
 * for newly scraped services costs only whatever is new.
 *
 * Only ever adds `nameEn` inside existing `services` array elements — never
 * touches `name`, `priceText`, `priceMxn`, `isFrom`, and never inserts or
 * deletes a row. Safe to re-run: anything that already has `nameEn` is
 * skipped, so an interrupted run picks back up where it left off.
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import type { ProviderService } from '../../src/types/provider';

const commit = process.argv.includes('--commit');

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

const env = loadEnv();
const TRANSLATE_KEY = env.GOOGLE_TRANSLATE_API_KEY;
const supabase = createClient(env.VITE_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

/** Accent- and case-insensitive key, so "Limpieza Dental" folds onto "limpieza dental". */
const foldKey = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .trim();

interface ProviderRow {
  id: string;
  services: ProviderService[] | null;
}

/** Cloud Translation v2 REST caps a single call well under this; stay conservative. */
const BATCH_SIZE = 50;

async function translateBatch(texts: string[]): Promise<string[]> {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${TRANSLATE_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source: 'es', target: 'en', format: 'text' }),
  });
  if (!res.ok) {
    throw new Error(`Cloud Translation API returned ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.data.translations.map((t: { translatedText: string }) => t.translatedText);
}

async function main() {
  console.log(`Mode: ${commit ? 'COMMIT (will call the API and write rows)' : 'DRY RUN (no API call, no writes)'}`);

  // Supabase caps a single select at 1000 rows (see useProviders.ts) — the
  // directory is larger than that, so page through or this silently
  // translates a fraction of the services and reports it as the whole thing.
  const PAGE_SIZE = 1000;
  const rows: ProviderRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('providers')
      .select('id, services')
      .not('services', 'is', null)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...((data ?? []) as ProviderRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  // Every distinct name still missing a translation, across the whole
  // directory — this is the set that actually gets billed, and it is far
  // smaller than the row count because service names repeat heavily.
  const pending = new Map<string, string>(); // foldKey -> original name
  let totalServiceInstances = 0;
  let alreadyTranslated = 0;

  for (const row of rows) {
    for (const s of row.services ?? []) {
      if (!s.name) continue;
      totalServiceInstances++;
      if (s.nameEn) { alreadyTranslated++; continue; }
      pending.set(foldKey(s.name), s.name);
    }
  }

  const uniqueNames = [...pending.values()];
  const totalChars = uniqueNames.reduce((sum, n) => sum + n.length, 0);

  // `.not('services', 'is', null)` still passes rows whose services column is
  // an empty jsonb array rather than SQL NULL, so this is "scanned", not
  // "has services" — the instance/character counts below are the honest ones.
  console.log(`Providers scanned: ${rows.length}`);
  console.log(`Service instances: ${totalServiceInstances} (${alreadyTranslated} already translated)`);
  console.log(`Unique names needing translation: ${uniqueNames.length}`);
  console.log(`Characters to translate: ${totalChars.toLocaleString()}`);
  console.log(`Estimated cost at $20/million chars: $${((totalChars / 1_000_000) * 20).toFixed(2)} (first 500K/month is typically free)`);

  if (uniqueNames.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (!commit) {
    console.log('\nDry run — no API call made, no rows written. Re-run with --commit to translate for real.');
    console.log('Sample of what would be sent:', uniqueNames.slice(0, 5));
    return;
  }

  if (!TRANSLATE_KEY) {
    console.error('\nGOOGLE_TRANSLATE_API_KEY is not set in .env.local — cannot commit. See the header comment for how to get one.');
    process.exit(1);
  }

  // foldKey -> English translation, filled in as batches complete.
  const translations = new Map<string, string>();
  const keys = [...pending.keys()];

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batchKeys = keys.slice(i, i + BATCH_SIZE);
    const batchTexts = batchKeys.map((k) => pending.get(k)!);
    console.log(`Translating ${i + 1}-${Math.min(i + BATCH_SIZE, keys.length)} of ${keys.length}...`);
    const translated = await translateBatch(batchTexts);
    batchKeys.forEach((k, idx) => translations.set(k, translated[idx]));
  }

  let updated = 0;
  for (const row of rows) {
    let changed = false;
    const nextServices = (row.services ?? []).map((s) => {
      if (!s.name || s.nameEn) return s;
      const en = translations.get(foldKey(s.name));
      if (!en) return s;
      changed = true;
      return { ...s, nameEn: en };
    });

    if (!changed) continue;

    const { error: updateError } = await supabase
      .from('providers')
      .update({ services: nextServices })
      .eq('id', row.id);

    if (updateError) {
      console.error(`Failed to update provider ${row.id}:`, updateError.message);
      continue;
    }
    updated++;
  }

  console.log(`\nDone. Translated ${translations.size} unique names, updated ${updated} provider rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
