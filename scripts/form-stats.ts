/**
 * Form analytics report for the six /borderhealth forms.
 *
 *   npx tsx --env-file=.env.local scripts/form-stats.ts            overview + funnels
 *   npx tsx --env-file=.env.local scripts/form-stats.ts daily      per day
 *   npx tsx --env-file=.env.local scripts/form-stats.ts sources    who / which link brought people
 *   npx tsx --env-file=.env.local scripts/form-stats.ts audience   country, city, device, browser
 *   npx tsx --env-file=.env.local scripts/form-stats.ts visitors   one row per browser (+ contact if submitted)
 *   npx tsx --env-file=.env.local scripts/form-stats.ts events     last 50 raw events
 *   add --json for machine-readable output
 *
 * Needs VITE_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 */
const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local).');
    process.exit(1);
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const mode = args.find((a) => !a.startsWith('--')) ?? 'overview';

async function get(path: string): Promise<Record<string, unknown>[]> {
    const r = await fetch(`${url!.replace(/\/$/, '')}/rest/v1/${path}`, {
        headers: { apikey: key!, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    return (await r.json()) as Record<string, unknown>[];
}

function show(title: string, rows: Record<string, unknown>[]) {
    console.log(`\n== ${title} ==`);
    if (rows.length === 0) console.log('(no data yet)');
    else console.table(rows);
}

const FORM_URL = 'https://medsociety.one/borderhealth';

async function main() {
    const data: Record<string, unknown> = {};
    const sets: [string, string][] =
        mode === 'daily' ? [['Per day', 'form_daily?order=day.desc,form_segment,lang&limit=200']]
        : mode === 'sources' ? [['By source / link', 'form_by_source?order=visits.desc&limit=200']]
        : mode === 'audience' ? [['Audience', 'form_audience?order=visits.desc&limit=200']]
        : mode === 'visitors' ? [['Visitors', 'form_visitors?order=last_seen.desc&limit=500']]
        : mode === 'events' ? [['Last 50 events', 'form_events?select=created_at,event,form_segment,lang,step_id,ref,country,city,device_type,session,is_bot&order=created_at.desc&limit=50']]
        : [
            ['Per form (the six URLs)', 'form_summary?order=form_segment,lang'],
            ['Screen-by-screen funnel', 'form_step_funnel?order=form_segment,lang,screen_no'],
        ];
    for (const [title, path] of sets) {
        const rows = await get(path);
        data[title] = rows;
        if (!json) show(title, rows);
    }
    if (mode === 'overview') {
        const total = await get('form_events?select=id&session=eq.test&limit=1');
        if (!json) {
            console.log(`\nForms: ${FORM_URL}?seg=<employer|employee|provider>&lang=<en|es>`);
            console.log('Test sessions (?session=test) and bots are excluded from every view above.');
            if (total.length) console.log('There are test-session events in the raw table.');
        }
    }
    if (json) console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
    console.error(String(e));
    process.exit(1);
});
