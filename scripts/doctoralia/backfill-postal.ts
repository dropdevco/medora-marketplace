/**
 * Extract the postal / ZIP code out of `providers.address` into its own column.
 *
 *   npx tsx scripts/doctoralia/backfill-postal.ts            # dry run
 *   npx tsx scripts/doctoralia/backfill-postal.ts --commit
 *
 * Run scripts/doctoralia/schema-005-postal-code.sql first.
 *
 * Four address shapes exist in the table, from the two ingestion paths:
 *
 *   Google MX      "Rio Chuviscar 1190, Los Nogales, 32350 Juárez, Chih., Mexico"
 *   Google US      "14240 Edgemere Blvd, El Paso, TX 79938, USA"
 *   Doctoralia     "Av. López Mateos 1230, Los Nogales, 32350, Ciudad Juarez, ..."
 *   City-then-code "Av. de Las Fuentes 1543, Ciudad Juarez 32500, México"
 *
 * Only ever updates the new column — never inserts or deletes a row.
 */
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { createClient } from '@supabase/supabase-js';

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
const supabase = createClient(env.VITE_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

/**
 * The code always sits in a comma-delimited field, either alone or adjacent to
 * the city / state. Scanning field-by-field rather than running one regex over
 * the whole string is what keeps a five-digit street number from matching.
 */
export function postalOf(address: string | null): string | null {
  if (!address) return null;

  const fields = address.split(',');
  // Skip the street line. "14240 Edgemere Blvd" and "12345 Long Street" both
  // start with five digits, and reading those as postal codes is exactly the
  // mistake this function exists to avoid. A postal code is never in field 0.
  for (let i = 1; i < fields.length; i++) {
    const part = fields[i].trim();

    // "32350" — Doctoralia writes it as its own field
    if (/^\d{5}$/.test(part)) return part;

    // "32350 Juárez" / "32300 México" — Google MX puts it before the city
    let m = part.match(/^(\d{5})\s+\D/);
    if (m) return m[1];

    // "TX 79938" — Google US puts it after the state abbreviation
    m = part.match(/^[A-Z]{2}\s+(\d{5})$/);
    if (m) return m[1];

    // "Ciudad Juarez 32500" — city first, code last
    m = part.match(/\D\s+(\d{5})$/);
    if (m) return m[1];
  }

  // A handful of rows have no street line at all ("32599 Ciudad Juárez, ..."),
  // so field 0 IS the postal field. Only trust it when a city name follows,
  // which is what separates it from a street number.
  const first = fields[0]?.trim() ?? '';
  const leading = first.match(/^(\d{5})\s+(?:Cd\.?\s+|Ciudad\s+)?(?:Ju[aá]rez|El Paso|M[eé]xico)\b/i);
  if (leading) return leading[1];

  // Same situation, but the code is its own field: "32617, Ciudad Juarez, ...".
  // Safe without a city check, because the risk this whole function guards
  // against is a street *number*, and a street line always carries a name
  // beside the number — five digits alone are never an address.
  if (/^\d{5}$/.test(first) && fields.length > 1) return first;

  return null;
}

interface Row {
  id: string;
  name: string;
  address: string | null;
  postalCode: string | null;
}

async function run() {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('providers')
      .select('id,name,address,"postalCode"')
      .range(from, from + 999);
    if (error) throw new Error(`could not read providers: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }

  const parsed = rows.map((r) => ({ row: r, code: postalOf(r.address) }));
  const hits = parsed.filter((p) => p.code);
  const misses = parsed.filter((p) => !p.code && p.row.address);
  const noAddress = parsed.filter((p) => !p.row.address);

  const pct = ((hits.length / rows.length) * 100).toFixed(1);
  console.log(`\n📮 Postal code backfill${commit ? '' : ' (dry run)'}\n`);
  console.log(`  providers            ${rows.length}`);
  console.log(`  code extracted       ${hits.length} (${pct}%)`);
  console.log(`  no code found        ${misses.length}`);
  console.log(`  no address at all    ${noAddress.length}`);

  const byCode = new Map<string, number>();
  for (const h of hits) byCode.set(h.code!, (byCode.get(h.code!) ?? 0) + 1);
  const ranked = [...byCode.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  distinct codes       ${ranked.length}`);
  console.log(`  busiest              ${ranked.slice(0, 5).map(([c, n]) => `${c}=${n}`).join('  ')}`);

  if (misses.length) {
    console.log('\n  unparsed addresses (first 10) — check these before committing:');
    for (const m of misses.slice(0, 10)) console.log(`    ${m.row.address}`);
  }

  if (!commit) {
    console.log('\n  Dry run — nothing written. Re-run with --commit.\n');
    return;
  }

  // Only write rows whose value actually changes, so a re-run is close to free.
  const toWrite = hits.filter((h) => h.row.postalCode !== h.code);
  console.log(`\n  rows needing an update: ${toWrite.length}`);

  let updated = 0;
  for (const { row, code } of toWrite) {
    const { error } = await supabase.from('providers').update({ postalCode: code }).eq('id', row.id);
    if (error) {
      console.error(`  ✖ ${row.name}: ${error.message}`);
      continue;
    }
    updated++;
    if (updated % 200 === 0) process.stdout.write(`\r  updated ${updated}/${toWrite.length}`);
  }

  console.log(`\n  ✅ updated ${updated}`);
}

// Only run when invoked directly, so postalOf() can be imported and tested.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error('\n✖ fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
