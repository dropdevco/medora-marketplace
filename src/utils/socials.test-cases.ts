/**
 * Run with:  npx tsx src/utils/socials.test-cases.ts
 * Throws (non-zero exit) if any case fails.
 */
import { normalizeSocial, normalizeWebsite, type SocialNetwork } from './socials';

interface Case {
    name: string;
    network: SocialNetwork;
    input: string;
    url?: string;
    error?: string;
    wrongNetwork?: SocialNetwork;
}

const cases: Case[] = [
    // handles
    { name: 'ig @handle', network: 'instagram', input: '@drsmith', url: 'https://instagram.com/drsmith' },
    { name: 'ig bare handle', network: 'instagram', input: 'dr.smith_mx', url: 'https://instagram.com/dr.smith_mx' },
    { name: 'ig full URL + tracking', network: 'instagram', input: 'https://www.instagram.com/drsmith/?igsh=abc123&utm_source=qr', url: 'https://instagram.com/drsmith' },
    { name: 'ig no scheme', network: 'instagram', input: 'instagram.com/drsmith', url: 'https://instagram.com/drsmith' },
    { name: 'ig post link rejected', network: 'instagram', input: 'https://instagram.com/p/Cabc123/', error: 'invalid' },
    { name: 'fb page URL + fbclid', network: 'facebook', input: 'https://m.facebook.com/clinicaSmith?fbclid=XYZ', url: 'https://facebook.com/clinicaSmith' },
    { name: 'fb profile.php id', network: 'facebook', input: 'https://facebook.com/profile.php?id=100012345678&sk=about', url: 'https://facebook.com/profile.php?id=100012345678' },
    { name: 'tiktok @handle', network: 'tiktok', input: '@drsmith', url: 'https://tiktok.com/@drsmith' },
    { name: 'tiktok URL', network: 'tiktok', input: 'https://www.tiktok.com/@drsmith?lang=es', url: 'https://tiktok.com/@drsmith' },
    { name: 'youtube @handle', network: 'youtube', input: '@drsmith', url: 'https://youtube.com/@drsmith' },
    { name: 'youtube channel URL', network: 'youtube', input: 'https://www.youtube.com/channel/UCabcdefghijklmnop?si=1', url: 'https://youtube.com/channel/UCabcdefghijklmnop' },
    { name: 'youtube video rejected', network: 'youtube', input: 'https://www.youtube.com/watch?v=abc', error: 'invalid' },
    { name: 'x from twitter.com', network: 'x', input: 'https://twitter.com/drsmith?s=20', url: 'https://x.com/drsmith' },
    { name: 'x @handle', network: 'x', input: '@dr_smith', url: 'https://x.com/dr_smith' },
    { name: 'linkedin /in URL', network: 'linkedin', input: 'https://www.linkedin.com/in/jane-doe-123/?trk=x', url: 'https://linkedin.com/in/jane-doe-123' },
    { name: 'linkedin company', network: 'linkedin', input: 'linkedin.com/company/clinica-smith', url: 'https://linkedin.com/company/clinica-smith' },
    { name: 'linkedin bare handle needs url', network: 'linkedin', input: 'janedoe', error: 'needs_url' },

    // wrong domain
    { name: 'facebook URL in instagram field', network: 'instagram', input: 'https://facebook.com/drsmith', error: 'wrong_network', wrongNetwork: 'facebook' },
    { name: 'instagram URL in tiktok field', network: 'tiktok', input: 'instagram.com/drsmith', error: 'wrong_network', wrongNetwork: 'instagram' },
    { name: 'random site in facebook field', network: 'facebook', input: 'https://example.com/drsmith', error: 'invalid' },

    // garbage
    { name: 'garbage words', network: 'instagram', input: 'not a handle!!', error: 'invalid' },
    { name: 'javascript: scheme', network: 'facebook', input: 'javascript:alert(1)', error: 'invalid' },
    { name: 'symbols only', network: 'x', input: '@@@', error: 'invalid' },
    { name: 'x handle too long', network: 'x', input: 'this_handle_is_way_too_long', error: 'invalid' },
    { name: 'empty clears', network: 'instagram', input: '   ' },

    // whatsapp
    { name: 'wa digits with +', network: 'whatsapp', input: '+52 656 123 4567', url: 'https://wa.me/526561234567' },
    { name: 'wa formatted', network: 'whatsapp', input: '+52 (656) 123-4567', url: 'https://wa.me/526561234567' },
    { name: 'wa 00 prefix', network: 'whatsapp', input: '0052 656 123 4567', url: 'https://wa.me/526561234567' },
    { name: 'wa.me URL with text param', network: 'whatsapp', input: 'https://wa.me/526561234567?text=Hola', url: 'https://wa.me/526561234567' },
    { name: 'api.whatsapp.com send', network: 'whatsapp', input: 'https://api.whatsapp.com/send?phone=526561234567', url: 'https://wa.me/526561234567' },
    { name: 'wa national number needs country code', network: 'whatsapp', input: '656 123 4567', error: 'needs_country_code' },
    { name: 'wa letters rejected', network: 'whatsapp', input: 'call me', error: 'invalid' },
    { name: 'wa too short', network: 'whatsapp', input: '12345', error: 'invalid' },
    { name: 'facebook URL in whatsapp field', network: 'whatsapp', input: 'https://facebook.com/x1', error: 'wrong_network', wrongNetwork: 'facebook' },
];

let failed = 0;
for (const c of cases) {
    const r = normalizeSocial(c.network, c.input);
    const pass = r.url === c.url && r.error === c.error && r.wrongNetwork === c.wrongNetwork;
    if (!pass) failed++;
    console.log(
        `${pass ? 'PASS' : 'FAIL'}  [${c.network}] ${c.name}: ${JSON.stringify(c.input)} -> ${r.url ?? r.error ?? '(empty)'}` +
        (pass ? '' : `   expected ${c.url ?? c.error ?? '(empty)'}`),
    );
}

const web: Array<[string, string | undefined, string | undefined]> = [
    ['clinica.mx', 'https://clinica.mx', undefined],
    ['https://clinica.mx/es/', 'https://clinica.mx/es', undefined],
    ['ftp://clinica.mx', undefined, 'invalid'],
    ['not a site', undefined, 'invalid'],
    ['localhost', undefined, 'invalid'],
    ['', undefined, undefined],
];
for (const [input, url, error] of web) {
    const r = normalizeWebsite(input);
    const pass = r.url === url && r.error === error;
    if (!pass) failed++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  [website] ${JSON.stringify(input)} -> ${r.url ?? r.error ?? '(empty)'}`);
}

console.log(`\n${cases.length + web.length - failed}/${cases.length + web.length} passed`);
if (failed) throw new Error(`${failed} case(s) failed`);
