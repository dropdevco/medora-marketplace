/** Checks the postal parser against every address shape in the table.
 *  Run: npx tsx scripts/doctoralia/postal-selftest.ts */
import { postalOf } from './backfill-postal';

const cases: [string, string | null][] = [
  ['Rio Chuviscar 1190, Los Nogales, 32350 Juárez, Chih., Mexico', '32350'],
  ['14240 Edgemere Blvd Suite 105, El Paso, TX 79938, USA', '79938'],
  ['Av. López Mateos 1230, Los Nogales, 32350, Ciudad Juarez, Chihuahua, México', '32350'],
  ['Av. de Las Fuentes 1543, Ciudad Juarez 32500, México', '32500'],
  ['Cd. Juarez, Hidalgo, 32300 México, Chih., Mexico', '32300'],
  ['Blvd. Teófilo Borunda #8670, Partido Iglesias, 32528 Juárez, Chih., Mexico', '32528'],
  // A five-digit street number must not be mistaken for a postal code.
  ['12345 Long Street Name Without Any City Or Code', null],
  // No street line at all — field 0 is the postal field.
  ['32599 Ciudad Juárez, Chihuahua, Mexico', '32599'],
  // Same, but the code stands alone as its own field.
  ['32617, Ciudad Juarez, Chihuahua, México', '32617'],
  // Five digits with nothing after them are not an address, so not a code.
  ['12345', null],
  ['', null],
];

let failed = 0;
for (const [address, expected] of cases) {
  const actual = postalOf(address);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${JSON.stringify(address).slice(0, 62)} → ${actual}${ok ? '' : ` (want ${expected})`}`);
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
