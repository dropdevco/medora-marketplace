export type Country = 'MX' | 'US';
export type ProviderSource = 'google' | 'manual' | 'doctoralia';

export type Specialty =
  | 'dentist'
  | 'orthodontist'
  | 'plastic_surgery'
  | 'aesthetician'
  | 'obgyn'
  | 'physical_therapy'
  | 'massage'
  | 'optometry'
  | 'general'
  | 'pediatrics'
  | 'cardiology'
  | 'urgent_care'
  | 'mental_health'
  | 'pharmacy'
  | 'telehealth';

export const SpecialtyLabels: Record<Specialty, string> = {
  dentist: 'Dentist',
  orthodontist: 'Orthodontist',
  plastic_surgery: 'Plastic Surgery',
  aesthetician: 'Aesthetician',
  obgyn: 'OB/GYN & Women\'s Health',
  physical_therapy: 'Physical Therapy',
  massage: 'Massage Therapy',
  optometry: 'Vision & Optometry',
  general: 'Primary & Family Care',
  pediatrics: 'Pediatrics',
  cardiology: 'Cardiology',
  urgent_care: 'Urgent Care',
  mental_health: 'Mental Health',
  pharmacy: 'Pharmacy',
  telehealth: 'Telehealth',
};

/** One published service, as scraped from a Doctoralia profile. */
export interface ProviderService {
  name: string;
  slug?: string;
  /** Verbatim, e.g. '$1,500' or 'Desde $1,000'. Null when unpriced. */
  priceText?: string;
  /** Parsed lower bound in MXN. Null when the price text carried no number. */
  priceMxn?: number;
  /** True for "Desde $X" — the real price starts there and goes up. */
  isFrom?: boolean;
}

export interface Provider {
  id: string;
  name: string;
  specialty: Specialty[];
  country: Country;
  city: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  phone?: string;
  website?: string;
  email?: string;
  languages: string[];
  promoted: boolean;
  verified: boolean;
  source: ProviderSource;
  clicks: number;
  googlePlaceId?: string;
  doctoraliaId?: string;
  /** Insurers accepted, verbatim as published (e.g. 'GNP Seguros'). */
  insurances?: string[];
  /** Doctoralia profile with a bookable calendar. Null when there is none. */
  bookingUrl?: string;
  /** MX postal code or US ZIP, extracted from `address` by backfill-postal.ts. */
  postalCode?: string;
  imageUrl?: string;
  /** Published services and prices, denormalised by backfill-services.ts. */
  services?: ProviderService[];
  /** Cheapest priced service, denormalised so sorting never walks `services`. */
  priceFromMxn?: number;
}

export type SortMode = 'relevance' | 'rating' | 'reviews' | 'distance' | 'price';

/**
 * A geographic bounding box, in degrees.
 *
 * Shared between the map (which produces one from its camera) and the filter
 * layer (which consumes one as a spatial predicate), so both sides agree on
 * the shape rather than each declaring its own.
 */
export interface MapBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ProviderFilters {
  search: string;
  /** Multi-select: a provider matches if it holds *any* of these. */
  specialty: Specialty[];
  country: Country | '';
  minRating: number;
  /** Insurer names, verbatim. A provider matches if it accepts any of them. */
  insurances: string[];
  /** ISO-ish language codes as stored on the provider, e.g. 'en', 'es'. */
  languages: string[];
  /** Only providers with a bookable calendar. */
  bookableOnly: boolean;
  /** Only providers whose credentials we verified. */
  verifiedOnly: boolean;
  /**
   * Only providers that publish prices. Roughly a third of the directory does,
   * so this hides a lot — it is opt-in, and it gates `maxPriceMxn` because a
   * price ceiling on its own would silently drop everyone we have no price for.
   */
  withPricing: boolean;
  /** Ceiling in MXN on the cheapest service. Ignored unless `withPricing`. */
  maxPriceMxn: number | null;
  sort: SortMode;
  /**
   * A five-digit code the user searched for. When set, results are limited to
   * providers within `radiusKm` of that code's centre and sorted by distance.
   * Empty string means no location filter is active.
   */
  postalCode: string;
  /** Radius around `postalCode`, in kilometres. Ignored when postalCode is ''. */
  radiusKm: number;
  /**
   * The map viewport the user explicitly searched, via "Search this area".
   * Null when the map is not filtering — which is the default, because the
   * map must never narrow the results just by being panned.
   */
  mapArea: MapBox | null;
}
