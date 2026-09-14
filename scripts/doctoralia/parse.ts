import * as cheerio from 'cheerio';
import { mapSpecialties } from './specialties';
import type { DoctoraliaAddress, DoctoraliaProfile, DoctoraliaReview, EntityType, IndexEntry } from './types';

const clean = (s: string | undefined | null): string | null => {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim().replace(/,$/, '').trim();
  return t.length ? t : null;
};

function jsonLd(html: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // Doctoralia emits one block per entity; a malformed one shouldn't kill the record.
    }
  }
  return out;
}

/**
 * Doctoralia does not publish the practice's own phone number. The only number
 * in the markup is their 24/7 booking-assistant line (656 738 xxxx), allocated
 * per address and routed by Doctoralia. We capture it, labelled honestly, and
 * never promote it to providers.phone.
 */
function extractDoctoraliaPhone($: cheerio.CheerioAPI, $card: cheerio.Cheerio<any>): string | null {
  const tel = $card.find('a[href^="tel:"]').first().attr('href');
  if (tel) return clean(decodeURIComponent(tel.replace(/^tel:/, '')));

  // Fallback: the digits are baked into the modal id, e.g. address-548761-6567380956-secretary-ai-phone
  const target = $card.find('[data-id="show-phone-number-modal"]').attr('data-target') ?? '';
  const m = target.match(/address-\d+-(\d{10,13})-secretary-ai-phone/);
  return m ? m[1] : null;
}

/** The per-address modals ("Compañías aseguradoras aceptadas", "Métodos de pago") list plain <h5> rows. */
function modalItems($: cheerio.CheerioAPI, modalId: string): string[] {
  const read = (sel: string) =>
    $(`[data-id="${modalId}"] .modal-body ${sel}`)
      .map((_i, el) => clean($(el).text()) ?? '')
      .get()
      .filter(Boolean);
  // Insurers render as <h5> rows, payment methods as <li> rows.
  const items = read('h5').length ? read('h5') : read('li');
  return [...new Set(items)];
}

/**
 * Insurers are also serialised as a JSON prop on the Vue island, which is the
 * complete list rather than the truncated "+1 ver más" display list.
 */
function insurancesFromVueProps($: cheerio.CheerioAPI): string[] {
  const names = new Set<string>();
  $('insurances-list, insurance-checker-button').each((_i, el) => {
    for (const attr of [':all-bookable-insurances', ':doctors-insurances', ':displayed-insurances']) {
      const raw = $(el).attr(attr);
      if (!raw) continue;
      try {
        for (const item of JSON.parse(raw) as any[]) {
          const name = clean(item?.name ?? item?.insurance?.name);
          if (name) names.add(name);
        }
      } catch {
        // prop shape changed — skip rather than lose the whole profile
      }
    }
  });
  return [...names];
}

function extractAddresses($: cheerio.CheerioAPI): DoctoraliaAddress[] {
  const addresses: DoctoraliaAddress[] = [];

  $('[data-id="doctor-address-item"]').each((_, el) => {
    const $card = $(el);

    const mapHref = $card.find('a[href*="google.com/maps"]').first().attr('href') ?? '';
    const coords = mapHref.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);

    // The location header emits bare <span content="..."> nodes in a fixed order:
    // postal code, city (.city), province (.province), country code.
    const $loc = $card.find('.profile-address-card__location').first();
    const postalCode = clean($loc.find('span[content]').not('.city').not('.province').first().attr('content'));
    const countryCode = clean(
      $loc
        .find('span[content]')
        .filter((_i, s) => /^[A-Z]{2}$/.test($(s).attr('content') ?? ''))
        .first()
        .attr('content'),
    );

    const services: DoctoraliaAddress['services'] = [];
    $card.find('[data-test-id="address-service-item"]').each((_i, s) => {
      const $s = $(s);
      const name = clean($s.find('a').first().text());
      if (!name) return;
      services.push({
        name,
        price: clean($s.find('[data-id="service-price"]').text())?.replace(/^[••]\s*/, '') ?? null,
        // /tratamientos-servicios/<slug>/ciudad-juarez — stable identity for the treatment
        slug: $s.find('a[href*="/tratamientos-servicios/"]').first().attr('href')?.split('/')[2] ?? null,
      });
    });

    const addressId =
      ($card.attr('data-tab-id') ?? $card.attr('id') ?? '').match(/address-(\d+)/)?.[1] ?? null;

    addresses.push({
      addressId,
      insurances: addressId ? modalItems($, `address-${addressId}-insurances`) : [],
      paymentMethods: addressId ? modalItems($, `address-${addressId}-payments`) : [],
      clinicName: clean($card.find('[data-test-id="address-info-name"]').first().text()),
      street: clean($card.find('[data-test-id="address-info-street"]').first().text()),
      district: clean($card.find('[data-test-id="address-info-district"]').first().text()),
      postalCode,
      city: clean($loc.find('.city').first().attr('content')),
      province: clean($loc.find('.province').first().attr('content')),
      countryCode,
      lat: coords ? Number(coords[1]) : null,
      lng: coords ? Number(coords[2]) : null,
      doctoraliaPhone: extractDoctoraliaPhone($, $card),
      phone: null, // doctor pages never publish a direct line
      isOnlineOnly: $card.attr('data-address-is-online-only') === 'true',
      services,
    });
  });

  return addresses;
}

function extractReviews(physician: Record<string, any> | undefined): DoctoraliaReview[] {
  const raw = physician?.review;
  if (!Array.isArray(raw)) return [];
  return raw.map((r: any) => ({
    author: clean(r?.author?.name) ?? null,
    rating: typeof r?.reviewRating?.ratingValue === 'number' ? r.reviewRating.ratingValue : null,
    publishedAt: clean(r?.datePublished) ?? null,
    body: clean(r?.reviewBody) ?? null,
  }));
}

/**
 * Clinic ("/clinicas/...") pages use a different layout from doctor profiles:
 * one #contact-section per location, a single free-text address line, and —
 * unlike doctor pages — a real, directly-dialable phone number sitting in
 * `data-phone-number` (the markup only masks it visually).
 */
function extractFacilityAddresses($: cheerio.CheerioAPI): DoctoraliaAddress[] {
  const addresses: DoctoraliaAddress[] = [];

  $('#contact-section .tab-pane').each((i, el) => {
    const $pane = $(el);

    const mapHref = $pane.find('[data-test-id="contact-map-link"], a[href*="google.com/maps"]').first().attr('href') ?? '';
    const coords = mapHref.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);

    // "Av. Paseo Triunfo de la República 3980, Ciudad Juarez 32310"
    const full = clean($pane.find('[data-test-id="contact-facility-address"]').first().text());
    const tail = full?.split(',').pop()?.trim() ?? '';
    const postal = tail.match(/(\d{5})/)?.[1] ?? null;
    const city = clean(tail.replace(/\d{5}/, '')) ?? null;
    const street = full && full.includes(',') ? clean(full.slice(0, full.lastIndexOf(','))) : full;

    const phone = clean($pane.find('[data-phone-number]').first().attr('data-phone-number'));

    if (!full && !coords && !phone) return;

    addresses.push({
      addressId: $pane.attr('id')?.replace('tab-address-', '') ?? String(i + 1),
      insurances: [],
      paymentMethods: [],
      clinicName: clean($pane.find('[data-test-id="contact-facility-name"]').first().text()),
      street,
      district: null,
      postalCode: postal,
      city,
      province: null,
      countryCode: 'MX',
      lat: coords ? Number(coords[1]) : null,
      lng: coords ? Number(coords[2]) : null,
      doctoraliaPhone: null,
      phone,
      isOnlineOnly: false,
      services: [],
    });
  });

  return addresses;
}

export function parseProfile(html: string, entry: IndexEntry): DoctoraliaProfile {
  const $ = cheerio.load(html);
  const blocks = jsonLd(html);
  const physician = blocks.find((b) => b['@type'] === 'Physician' || b['@type'] === 'MedicalClinic');

  // "No. de cédula: 14237073 11747004" — one or more licence numbers, space separated.
  const cedulaText = $('p:contains("No. de cédula")').first().text();
  const cedulas = [...(cedulaText.match(/\d{5,10}/g) ?? [])];

  const specializations = [
    ...new Set(
      [
        ...entry.specializationNames,
        ...$('[data-test-id="doctor-specializations"]').map((_, el) => clean($(el).text()) ?? '').get(),
      ]
        // The heading doubles as a "· Ver más" disclosure toggle; keep only the names.
        .flatMap((s) => s.split(/[··]/))
        .map((s) => clean(s) ?? '')
        .filter((s) => s.length > 0 && !/^ver (m[aá]s|menos)/i.test(s) && !/especializaciones$/i.test(s)),
    ),
  ];

  const doctorAddresses = extractAddresses($);
  const addresses = doctorAddresses.length ? doctorAddresses : extractFacilityAddresses($);
  const website =
    clean($('a[data-avo-track="clinic-website-link"]').first().attr('href')) ?? null;
  const insurances = [
    ...new Set([...insurancesFromVueProps($), ...addresses.flatMap((a) => a.insurances)]),
  ].filter((n) => n !== 'Pacientes privados (sin aseguradora)');

  // Only the provider's own words. There is a meta description on every page,
  // but it is SEO boilerplate ("Ahorra tiempo agendando cita con…") — falling
  // back to it would report 100% coverage for a field that is often empty.
  const about = clean(
    $('[data-test-id="about-description"], [data-id="profile-about-text"], [data-test-id="profile-about"]')
      .first()
      .text(),
  );

  const imageUrl =
    $('meta[property="og:image"]').attr('content')?.replace(/_small_square\./, '_large.') ?? null;

  const rating = typeof physician?.aggregateRating?.ratingValue === 'number'
    ? physician.aggregateRating.ratingValue
    : entry.ratingFromListing;
  const reviewCount = typeof physician?.aggregateRating?.reviewCount === 'number'
    ? physician.aggregateRating.reviewCount
    : entry.reviewCountFromListing ?? 0;

  const missing: string[] = [];
  if (!cedulas.length) missing.push('cedulas');
  if (!addresses.length) missing.push('addresses');
  if (!addresses.some((a) => a.lat !== null)) missing.push('coordinates');
  if (!addresses.some((a) => a.services.length)) missing.push('services');
  if (!insurances.length) missing.push('insurances');
  if (!addresses.some((a) => a.phone)) missing.push('phone');
  if (!website) missing.push('website');
  if (!rating) missing.push('rating');
  if (!about) missing.push('about');

  return {
    doctoraliaId: entry.doctoraliaId,
    entityType: (entry.entityType ?? 'doctor') as EntityType,
    url: entry.url,
    slug: entry.url.split('/').pop() ?? '',
    name: clean(physician?.name) ?? entry.name,
    cedulas,
    specializations,
    foundUnderSlugs: entry.foundUnderSlugs,
    mappedSpecialties: mapSpecialties(entry.foundUnderSlugs),
    about,
    imageUrl,
    website,
    rating: rating ?? null,
    reviewCount,
    reviews: extractReviews(physician),
    insurances,
    addresses,
    // Doctoralia MX does not publish spoken languages. Defaulting to ['es']
    // here still asserted a fact nobody stated — checked against the scraped
    // `about` text, only 8 of 2,794 profiles even mention a language at all.
    // Left empty until a clinic confirms it through its own dashboard.
    languages: [],
    scrapedAt: new Date().toISOString(),
    missing,
  };
}
