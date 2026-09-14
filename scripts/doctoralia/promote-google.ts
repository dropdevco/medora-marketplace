/**
 * Promote the Google-only businesses into `providers`.
 *
 * The sweep found ~1,000 medical businesses in Ciudad Juárez. Roughly a quarter
 * matched a Doctoralia entity (those are promoted by load.ts). The rest exist
 * only in Google — real clinics, labs and consultorios that Doctoralia never
 * listed — and over 90% of them publish a phone number.
 *
 *   npx tsx scripts/doctoralia/promote-google.ts            # dry run
 *   npx tsx scripts/doctoralia/promote-google.ts --commit
 *
 * Insert-only: an existing providers row is never updated or deleted. Anything
 * that looks like a row you already have is skipped and reported, not merged.
 */
import * as fs from 'fs';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { distanceMeters, nameSimilarity } from './load';
import type { Specialty } from '../../src/types/provider';

const argv = process.argv.slice(2);
const commit = argv.includes('--commit');
const limit = Number(argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);

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
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✖ VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function selectAll<T>(table: string, columns: string, apply?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns);
    if (apply) q = apply(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`could not read ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Google's `types` are coarse ('doctor', 'dentist', 'hospital'), so this is a
 * best-effort classification. Anything unrecognised falls back to 'general'
 * rather than being dropped — a mislabelled provider is recoverable, a missing
 * one is invisible.
 */
function classify(types: string[], name: string): Specialty[] {
  const t = new Set(types);
  // Accent-fold before matching: 'Psicóloga' must hit the /psicolog/ pattern,
  // and Spanish business names are full of accents.
  const n = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const out = new Set<Specialty>();

  if (t.has('dentist') || /dental|odontolog|dentist/.test(n)) out.add('dentist');
  if (/ortodon|bracket/.test(n)) out.add('orthodontist');
  if (/plastic|estetic|cirugia pl/.test(n)) out.add('plastic_surgery');
  if (/spa|belleza|skin|piel|dermat/.test(n)) out.add('aesthetician');
  if (/ginec|obstetr|mujer|matern/.test(n)) out.add('obgyn');
  if (/laboratorio|analisis clinic|patolog/.test(n)) out.add('general');
  if (t.has('physiotherapist') || /fisioterap|rehabilitac|quiropr|terapia fisica/.test(n)) out.add('physical_therapy');
  if (/masaje|massage/.test(n)) out.add('massage');
  if (/optic|oftalmolog|vista|ojos|ocular|lentes/.test(n)) out.add('optometry');
  if (/pediatr|ninos|infantil/.test(n)) out.add('pediatrics');
  if (/cardiolog|corazon|cardiaco/.test(n)) out.add('cardiology');
  if (t.has('hospital') || /urgencia|emergenc/.test(n)) out.add('urgent_care');
  if (/psicolog|psiquiatr|salud mental|psicoterap|psicoanal/.test(n)) out.add('mental_health');
  if (t.has('pharmacy') || t.has('drugstore') || /farmacia/.test(n)) out.add('pharmacy');

  if (!out.size) out.add('general');
  return [...out];
}

interface GoogleRow {
  place_id: string;
  name: string;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  types: string[] | null;
  business_status: string | null;
}

interface ProviderRow {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  googlePlaceId: string | null;
}

const digits = (s: string | null) => (s ? s.replace(/\D/g, '') : '');

async function run() {
  const places = await selectAll<GoogleRow>(
    'google_places_juarez',
    'place_id,name,formatted_address,lat,lng,phone,website,rating,review_count,types,business_status',
    (q) => q.is('doctoralia_id', null),
  );
  const providers = await selectAll<ProviderRow>('providers', 'id,name,lat,lng,phone,"googlePlaceId"');

  console.log(`\n⬆ Google-only businesses → providers${commit ? '' : ' (dry run)'}\n`);
  console.log(`  candidates (unlinked to Doctoralia)  ${places.length}`);
  console.log(`  existing providers to check against  ${providers.length}`);

  const existingPlaceIds = new Set(providers.map((p) => p.googlePlaceId).filter(Boolean) as string[]);
  const existingPhones = new Set(providers.map((p) => digits(p.phone)).filter((d) => d.length >= 8));

  const skip = { closed: 0, noGeo: 0, samePlaceId: 0, samePhone: 0, nameGeo: 0 };
  const toInsert: GoogleRow[] = [];

  for (const g of places) {
    if (g.business_status && g.business_status !== 'OPERATIONAL') {
      skip.closed++; // permanently closed businesses are noise in a directory
      continue;
    }
    if (g.lat == null || g.lng == null) {
      skip.noGeo++;
      continue;
    }
    // Three independent duplicate checks — a business already in `providers`
    // from the original Google seed must not be inserted a second time.
    if (existingPlaceIds.has(g.place_id)) {
      skip.samePlaceId++;
      continue;
    }
    if (g.phone && existingPhones.has(digits(g.phone))) {
      skip.samePhone++;
      continue;
    }
    const dupe = providers.some(
      (p) =>
        p.lat != null &&
        p.lng != null &&
        distanceMeters(g.lat!, g.lng!, p.lat, p.lng) <= 150 &&
        nameSimilarity(g.name, p.name) >= 0.6,
    );
    if (dupe) {
      skip.nameGeo++;
      continue;
    }
    toInsert.push(g);
  }

  const capped = toInsert.slice(0, limit);
  console.log(`\n  skipped — permanently closed      ${skip.closed}`);
  console.log(`  skipped — no coordinates          ${skip.noGeo}`);
  console.log(`  skipped — same Google place id    ${skip.samePlaceId}`);
  console.log(`  skipped — same phone number       ${skip.samePhone}`);
  console.log(`  skipped — same name + location    ${skip.nameGeo}`);
  console.log(`\n  ${commit ? 'inserting' : 'would insert'}: ${capped.length}`);
  console.log(`    …with a phone:   ${capped.filter((g) => g.phone).length}`);
  console.log(`    …with a website: ${capped.filter((g) => g.website).length}`);

  if (!commit) {
    console.log('\n  sample:');
    for (const g of capped.slice(0, 5)) {
      console.log(`    ${g.name} · ${classify(g.types ?? [], g.name).join(', ')} · ${g.phone ?? 'no phone'}`);
    }
    console.log('\n  Dry run — nothing written. Re-run with --commit.\n');
    return;
  }

  let inserted = 0;
  for (const g of capped) {
    const row = {
      id: crypto.randomUUID(),
      name: g.name,
      specialty: classify(g.types ?? [], g.name),
      country: 'MX',
      city: 'Juárez',
      address: g.formatted_address,
      lat: g.lat,
      lng: g.lng,
      rating: g.rating ?? 0,
      reviewCount: g.review_count ?? 0,
      phone: g.phone,
      website: g.website,
      email: null,
      // Not a scraped fact — see migration 0004. Left empty until a clinic
      // states it through its own dashboard, or curation sets it by hand.
      languages: [],
      promoted: false,
      verified: false,
      source: 'google',
      clicks: 0,
      googlePlaceId: g.place_id,
    };

    const { error } = await supabase.from('providers').insert(row);
    if (error) {
      console.error(`  ✖ ${g.name}: ${error.message}`);
      continue;
    }
    inserted++;
    if (inserted % 50 === 0) process.stdout.write(`\r  inserted ${inserted}/${capped.length}`);
  }

  console.log(`\n\n  ✅ inserted ${inserted}`);
}

run().catch((err) => {
  console.error('\n✖ fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
