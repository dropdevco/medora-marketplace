-- Social profiles and a photo gallery per provider.
--
-- socials: { facebook, instagram, tiktok, youtube, x, linkedin, whatsapp }
--   each value is a full https URL (whatsapp: https://wa.me/<digits>). Keys are
--   omitted when unknown. Filled by scripts/doctoralia/backfill-media.ts for
--   scraped listings and by the clinic itself from the dashboard.
-- galleryUrls: ordered image URLs of a provider's own photos (Doctoralia
--   gallery for scraped listings). Owner-uploaded photos keep living in the
--   clinic_photos table / clinic-photos bucket and are merged in the UI.

alter table public.providers
  add column if not exists socials jsonb not null default '{}'::jsonb,
  add column if not exists "galleryUrls" text[] not null default '{}';

-- Owners edit their own social links from the dashboard (same row-level policy
-- as the other owner-editable columns, see 0003).
grant update (socials) on public.providers to authenticated;
