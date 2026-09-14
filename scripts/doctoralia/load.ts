/**
 * Load out/profiles.jsonl into Supabase, dedupe against `providers`, and
 * (optionally) promote the new ones into the marketplace.
 *
 *   npx tsx scripts/doctoralia/load.ts stage             # dry run
 *   npx tsx scripts/doctoralia/load.ts stage   --commit  # write staging tables
 *   npx tsx scripts/doctoralia/load.ts match   --commit  # dedupe vs providers
 *   npx tsx scripts/doctoralia/load.ts promote --commit  # insert approved rows into providers
 *
 * Nothing is written without --commit, and `promote` never updates or deletes
 * an existing providers row — it only inserts entities that matched nothing.
 */
import * as fs from 'fs';
import * as crypto from 'crypto';
import { pathToFileURL } from 'url';
import { createClient } from '@supabase/supabase-js';
import { PROFILES_FILE } from './config';
import type { DoctoraliaProfile } from './types';

const argv = process.argv.slice(2);
const phase = argv.find((a) => !a.startsWith('--')) ?? 'stage';
const commit = argv.includes('--commit');

// The scripts in this repo each parse .env.local themselves (no dotenv dep).
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Supabase over REST drops the occasional connection on a long sequential run
 * (a full stage/match is ~9,000 round trips). A transient `fetch failed` should
 * cost a retry, not the whole pass — the earlier match run died at 800/2794.
 */
// Accepts PromiseLike because Supabase query builders are thenable, not Promises.
async function withRetry<T>(label: string, fn: () => PromiseLike<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const backoff = 1_000 * 2 ** i;
      console.warn(`
  ↻ ${label} failed (${err instanceof Error ? err.message : err}) — retrying in ${backoff / 1000}s`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

function readProfiles(): DoctoraliaProfile[] {
  if (!fs.existsSync(PROFILES_FILE)) {
    console.error(`✖ ${PROFILES_FILE} not found — run the scrape first.`);
    process.exit(1);
  }
  const byId = new Map<string, DoctoraliaProfile>();
  for (const line of fs.readFileSync(PROFILES_FILE, 'utf-8').split('\n').filter(Boolean)) {
    try {
      const p = JSON.parse(line) as DoctoraliaProfile;
      byId.set(p.doctoraliaId, p); // last write wins on a re-scrape
    } catch {
      // half-written line from an interrupted run
    }
  }
  return [...byId.values()];
}

// ── normalisation ────────────────────────────────────────────────────────────

const TITLES = /\b(dr|dra|drs|lic|mtro|mtra|ing|c\.?d|m\.?c|md|phd|esp|prof)\b\.?/g;

/** Accent-folded, title-stripped, punctuation-free name for comparison. */
export function normName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(TITLES, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set Jaccard — order-insensitive, which suits Spanish two-surname names. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normName(a).split(' ').filter((t) => t.length > 2));
  const tb = new Set(normName(b).split(' ').filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / new Set([...ta, ...tb]).size;
}

/** Metres between two WGS84 points (haversine). */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** '$1,500' → 1500 · 'Desde $1,000' → 1000 (from) · 'Servicio gratuito' → 0 */
export function parsePrice(text: string | null): { mxn: number | null; isFrom: boolean } {
  if (!text) return { mxn: null, isFrom: false };
  if (/gratuito|gratis/i.test(text)) return { mxn: 0, isFrom: false };
  const isFrom = /desde/i.test(text);
  const m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return { mxn: m ? Number(m[1]) : null, isFrom };
}

/**
 * The El Paso / Ciudad Juárez region. Used to pick the right practice location:
 * a doctor listed in Juárez may also practise in Guadalajara or Mexico City,
 * and promoting the wrong address puts a pin 1,500km off and drags the map's
 * bounds with it.
 */
export const BORDER_BOX = { minLat: 31.3, maxLat: 32.2, minLng: -106.9, maxLng: -106.0 };

const inBorderRegion = (a: { lat: number | null; lng: number | null }) =>
  a.lat != null &&
  a.lng != null &&
  a.lat >= BORDER_BOX.minLat &&
  a.lat <= BORDER_BOX.maxLat &&
  a.lng >= BORDER_BOX.minLng &&
  a.lng <= BORDER_BOX.maxLng;

function primaryAddress(p: DoctoraliaProfile) {
  return (
    // Coordinates first: the `city` string is often missing or spelled
    // differently, and matching on it silently selected out-of-region practices.
    p.addresses.find(inBorderRegion) ??
    p.addresses.find((a) => /ju[aá]rez/i.test(a.city ?? '') && a.lat !== null) ??
    p.addresses.find((a) => a.lat !== null) ??
    p.addresses[0] ??
    null
  );
}

function formatAddress(p: DoctoraliaProfile): string | null {
  const a = primaryAddress(p);
  if (!a) return null;
  return [a.street, a.district, a.postalCode, a.city, a.province, a.countryCode === 'MX' ? 'México' : a.countryCode]
    .filter(Boolean)
    .join(', ');
}

// ── phase: stage ─────────────────────────────────────────────────────────────

async function stage() {
  const profiles = readProfiles();
  console.log(`\n📥 Staging ${profiles.length} entities${commit ? '' : ' (dry run — pass --commit to write)'}\n`);

  const doctors = profiles.map((p) => ({
    doctoralia_id: p.doctoraliaId,
    entity_type: p.entityType,
    name: p.name,
    slug: p.slug,
    url: p.url,
    cedulas: p.cedulas,
    specializations: p.specializations,
    found_under_slugs: p.foundUnderSlugs,
    mapped_specialties: p.mappedSpecialties,
    about: p.about,
    image_url: p.imageUrl,
    rating: p.rating,
    review_count: p.reviewCount,
    insurances: p.insurances,
    languages: p.languages,
    is_promoted: false,
    scraped_at: p.scrapedAt,
    raw: p,
    updated_at: new Date().toISOString(),
  }));

  console.log(`  doctoralia_doctors    ${doctors.length}`);
  console.log(`  doctoralia_addresses  ${profiles.reduce((n, p) => n + p.addresses.length, 0)}`);
  console.log(
    `  doctoralia_services   ${profiles.reduce((n, p) => n + p.addresses.reduce((m, a) => m + a.services.length, 0), 0)}`,
  );
  console.log(`  doctoralia_reviews    ${profiles.reduce((n, p) => n + p.reviews.length, 0)}`);

  if (!commit) return;

  for (let i = 0; i < doctors.length; i += 200) {
    const chunk = doctors.slice(i, i + 200);
    const { error } = await supabase.from('doctoralia_doctors').upsert(chunk, { onConflict: 'doctoralia_id' });
    if (error) throw new Error(`doctoralia_doctors upsert failed: ${error.message}`);
    process.stdout.write(`\r  doctors ${Math.min(i + 200, doctors.length)}/${doctors.length}`);
  }
  console.log();

  // Addresses are replaced wholesale per doctor so a re-scrape drops stale locations.
  for (const [i, p] of profiles.entries()) {
    await withRetry(`clear addresses ${p.doctoraliaId}`, () =>
      supabase.from('doctoralia_addresses').delete().eq('doctoralia_id', p.doctoraliaId));

    for (const a of p.addresses) {
      const { data, error } = await withRetry(`address ${p.doctoraliaId}`, () =>
        supabase
        .from('doctoralia_addresses')
        .insert({
          doctoralia_id: p.doctoraliaId,
          address_id: a.addressId,
          clinic_name: a.clinicName,
          street: a.street,
          district: a.district,
          postal_code: a.postalCode,
          city: a.city,
          province: a.province,
          country_code: a.countryCode,
          lat: a.lat,
          lng: a.lng,
          doctoralia_phone: a.doctoraliaPhone,
          phone: a.phone,
          is_online_only: a.isOnlineOnly,
          insurances: a.insurances,
          payment_methods: a.paymentMethods,
        })
        .select('id')
        .single());
      if (error) throw new Error(`address insert failed for ${p.doctoraliaId}: ${error.message}`);

      if (a.services.length) {
        const rows = a.services.map((s) => {
          const { mxn, isFrom } = parsePrice(s.price);
          return {
            address_id: data.id,
            doctoralia_id: p.doctoraliaId,
            name: s.name,
            slug: s.slug,
            price_text: s.price,
            price_mxn: mxn,
            price_is_from: isFrom,
          };
        });
        const { error: sErr } = await supabase.from('doctoralia_services').insert(rows);
        if (sErr) throw new Error(`services insert failed for ${p.doctoraliaId}: ${sErr.message}`);
      }
    }

    if (p.reviews.length) {
      const rows = p.reviews
        .filter((r) => r.publishedAt)
        .map((r) => ({
          doctoralia_id: p.doctoraliaId,
          author: r.author,
          rating: r.rating,
          published_at: r.publishedAt,
          body: r.body,
        }));
      if (rows.length) {
        const { error: rErr } = await supabase
          .from('doctoralia_reviews')
          .upsert(rows, { onConflict: 'doctoralia_id,author,published_at', ignoreDuplicates: true });
        if (rErr) throw new Error(`reviews upsert failed for ${p.doctoraliaId}: ${rErr.message}`);
      }
    }

    if ((i + 1) % 25 === 0 || i === profiles.length - 1) {
      process.stdout.write(`\r  addresses/services/reviews ${i + 1}/${profiles.length}`);
    }
  }
  console.log('\n  ✅ staged');
}

// ── phase: match ─────────────────────────────────────────────────────────────

interface ProviderRow {
  id: string;
  name: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  source: string | null;
}

async function fetchProviders(): Promise<ProviderRow[]> {
  const all: ProviderRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('providers')
      .select('id,name,city,lat,lng,phone,source')
      .range(from, from + 999);
    if (error) throw new Error(`providers fetch failed: ${error.message}`);
    all.push(...(data as ProviderRow[]));
    if (!data || data.length < 1000) break;
  }
  return all;
}

/**
 * Dedupe rules, deliberately conservative:
 *
 *  - A Doctoralia *doctor* is a person; an existing Google row is almost always
 *    a clinic. "Dr. X who works at Hospital Ángeles" must not collapse into the
 *    "Hospital Ángeles" row, so we compare person-name to provider-name only —
 *    never the clinic label — and require both a name and a location agreement.
 *  - A Doctoralia *facility* can legitimately be the same business as a Google
 *    row, so the same rule catches it via the name.
 *  - Phone is NOT used: the only number Doctoralia publishes is their own
 *    booking-assistant line, which is identical in shape across all doctors.
 */
function classify(p: DoctoraliaProfile, providers: ProviderRow[]) {
  const addr = primaryAddress(p);
  let best: { provider: ProviderRow; sim: number; dist: number | null } | null = null;

  for (const prov of providers) {
    const sim = nameSimilarity(p.name, prov.name);
    if (sim < 0.5) continue;
    const dist =
      addr?.lat != null && addr.lng != null && prov.lat != null && prov.lng != null
        ? distanceMeters(addr.lat, addr.lng, prov.lat, prov.lng)
        : null;
    if (!best || sim > best.sim || (sim === best.sim && (dist ?? Infinity) < (best.dist ?? Infinity))) {
      best = { provider: prov, sim, dist };
    }
  }

  if (!best) return { method: 'new' as const, confidence: 0, match: null };
  if (best.sim >= 0.95 && (best.dist === null || best.dist <= 1000)) {
    return { method: 'name_geo' as const, confidence: Number(best.sim.toFixed(2)), match: best };
  }
  if (best.sim >= 0.8 && best.dist !== null && best.dist <= 300) {
    return { method: 'name_geo' as const, confidence: Number(best.sim.toFixed(2)), match: best };
  }
  if (best.sim >= 0.65) {
    return { method: 'possible' as const, confidence: Number(best.sim.toFixed(2)), match: best };
  }
  return { method: 'new' as const, confidence: 0, match: null };
}

async function match() {
  const profiles = readProfiles();
  const providers = await fetchProviders();
  console.log(`\n🔍 Matching ${profiles.length} scraped entities against ${providers.length} existing providers\n`);

  const buckets = { new: 0, name_geo: 0, possible: 0 };
  const updates: { doctoralia_id: string; provider_id: string | null; match_method: string; match_confidence: number; review_status: string }[] = [];
  const samples: string[] = [];

  for (const p of profiles) {
    const { method, confidence, match: m } = classify(p, providers);
    buckets[method]++;
    updates.push({
      doctoralia_id: p.doctoraliaId,
      provider_id: method === 'name_geo' ? m!.provider.id : null,
      match_method: method,
      match_confidence: confidence,
      // Only clean 'new' rows are auto-approved for promotion; anything that
      // looked like an existing provider waits for a human.
      review_status: method === 'new' ? 'approved' : 'pending',
    });
    if (m && samples.length < 15) {
      samples.push(
        `    ${method.padEnd(9)} ${confidence.toFixed(2)}  ${p.name}  ↔  ${m.provider.name}` +
          (m.dist !== null ? `  (${Math.round(m.dist)}m)` : '  (no geo)'),
      );
    }
  }

  console.log(`  new (no existing provider)   ${buckets.new}`);
  console.log(`  matched an existing provider ${buckets.name_geo}`);
  console.log(`  possible duplicate, review   ${buckets.possible}`);
  if (samples.length) console.log('\n  sample decisions:\n' + samples.join('\n'));

  if (!commit) {
    console.log('\n  (dry run — pass --commit to persist match results)');
    return;
  }

  for (let i = 0; i < updates.length; i += 200) {
    for (const u of updates.slice(i, i + 200)) {
      const { error } = await supabase
        .from('doctoralia_doctors')
        .update({
          provider_id: u.provider_id,
          match_method: u.match_method,
          match_confidence: u.match_confidence,
          review_status: u.review_status,
          updated_at: new Date().toISOString(),
        })
        .eq('doctoralia_id', u.doctoralia_id);
      if (error) throw new Error(`match update failed for ${u.doctoralia_id}: ${error.message}`);
    }
    process.stdout.write(`\r  persisted ${Math.min(i + 200, updates.length)}/${updates.length}`);
  }
  console.log('\n  ✅ matched');
}

// ── phase: promote ───────────────────────────────────────────────────────────

async function promote() {
  const profiles = new Map(readProfiles().map((p) => [p.doctoraliaId, p]));

  // Page: Supabase caps a select at 1,000 rows and there are ~2,700 approved.
  const data: {
    doctoralia_id: string;
    google_phone: string | null;
    google_website: string | null;
    google_place_id: string | null;
    google_match_type: string | null;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await supabase
      .from('doctoralia_doctors')
      .select('doctoralia_id,google_phone,google_website,google_place_id,google_match_type')
      .eq('review_status', 'approved')
      .is('provider_id', null)
      .range(from, from + 999);
    if (error) throw new Error(`could not read approved rows: ${error.message}`);
    data.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }

  const approved = data.filter((r) => profiles.has(r.doctoralia_id));
  console.log(`\n⬆ Promoting ${approved.length} approved entities into providers${commit ? '' : ' (dry run)'}\n`);

  let inserted = 0;
  let skipped = 0;
  let withPhone = 0;
  let linkedToExisting = 0;

  for (const row of approved) {
    const p = profiles.get(row.doctoralia_id)!;
    const addr = primaryAddress(p);
    if (!addr?.lat || !addr?.lng) {
      skipped++; // the map needs coordinates; leave it staged for manual geocoding
      continue;
    }
    const isEntityMatch = row.google_match_type === 'entity';

    const providerRow = {
      id: crypto.randomUUID(),
      name: p.name,
      specialty: p.mappedSpecialties.length ? p.mappedSpecialties : ['general'],
      country: 'MX',
      // Existing Juárez rows use 'Juárez'; keep one spelling so filters group.
      city: 'Juárez',
      address: formatAddress(p),
      lat: addr.lat,
      lng: addr.lng,
      rating: p.rating ?? 0,
      reviewCount: p.reviewCount,
      // Order of preference for contact details:
      //   1. what the clinic published on Doctoralia itself
      //   2. a Google listing that IS this provider ('entity')
      // A 'venue' match is the building's switchboard, not this provider's
      // line, so it is deliberately not promoted — see sweep.ts.
      phone: p.addresses.find((a) => a.phone)?.phone ?? (isEntityMatch ? row.google_phone : null),
      website: p.website ?? (isEntityMatch ? row.google_website : null),
      email: null,
      // Not a scraped fact — see migration 0004. Left empty until a clinic
      // states it through its own dashboard, or curation sets it by hand.
      languages: [],
      promoted: false,
      verified: p.cedulas.length > 0,
      source: 'doctoralia',
      clicks: 0,
      imageUrl: p.imageUrl,
      doctoraliaId: p.doctoraliaId,
      googlePlaceId: isEntityMatch ? row.google_place_id : null,
    };

    if (providerRow.phone) withPhone++;

    if (!commit) {
      if (inserted < 3) {
        console.log(
          `    would insert: ${providerRow.name} · ${providerRow.specialty.join(', ')} · ` +
            `${providerRow.phone ?? 'no phone'}`,
        );
      }
      inserted++;
      continue;
    }

    const { error: insErr } = await supabase.from('providers').insert(providerRow);
    if (insErr) {
      // A duplicate googlePlaceId means this entity IS an existing provider that
      // the name matcher missed — the unique index caught what we didn't. Link
      // to that row instead of dropping the entity on the floor.
      if (insErr.message.includes('googlePlaceId') && providerRow.googlePlaceId) {
        const { data: existing } = await supabase
          .from('providers')
          .select('id')
          .eq('googlePlaceId', providerRow.googlePlaceId)
          .maybeSingle();
        if (existing) {
          await supabase
            .from('doctoralia_doctors')
            .update({
              provider_id: existing.id,
              match_method: 'google_place_id',
              match_confidence: 1,
              review_status: 'duplicate',
              updated_at: new Date().toISOString(),
            })
            .eq('doctoralia_id', p.doctoraliaId);
          linkedToExisting++;
          continue;
        }
      }
      console.error(`  ✖ insert failed for ${p.name}: ${insErr.message}`);
      continue;
    }
    await supabase
      .from('doctoralia_doctors')
      .update({ provider_id: providerRow.id, updated_at: new Date().toISOString() })
      .eq('doctoralia_id', p.doctoraliaId);
    inserted++;
    if (inserted % 25 === 0) process.stdout.write(`\r  inserted ${inserted}/${approved.length}`);
  }

  console.log(`\n  ${commit ? 'inserted' : 'would insert'}: ${inserted}`);
  console.log(`  ...with a phone:            ${withPhone}`);
  console.log(`  linked to existing row:   ${linkedToExisting}`);
  console.log(`  skipped (no coordinates): ${skipped}`);
}

// Only run when invoked directly — selftest.ts imports the helpers above.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  void (async () => {
  if (phase === 'stage') await stage();
  else if (phase === 'match') await match();
  else if (phase === 'promote') await promote();
  else {
    console.error(`unknown phase "${phase}" — expected stage | match | promote`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('\n✖ fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
}
