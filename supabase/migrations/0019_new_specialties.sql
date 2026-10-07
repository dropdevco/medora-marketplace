-- Neurology, ENT (otolaryngology) and orthopedics as specialties of their own.
--
-- They used to be folded into 'general' (scripts/doctoralia/specialties.ts),
-- which hid ~230 specialists among 1,700 general practitioners and left the AI
-- symptom search nothing better than "general" to recommend for a headache,
-- an earache or a bad knee. The keys live in the Specialty union in
-- src/types/provider.ts; `providers.specialty` is a plain text[], so this only
-- re-tags rows.
--
-- Rules:
--   * Add the new key wherever Doctoralia lists the entity under the matching
--     slug or specialization label.
--   * Drop 'general' only from individual doctors (not clinics) whose every
--     Doctoralia specialization is in one of the new fields. Someone who also
--     lists "Medicina General" keeps it.
--   * Google-only listings are tagged by name, skipping names that read as
--     orthopedic supply shops or alternative practices rather than doctors.

create temporary table new_specialty_tags on commit drop as
select d.doctoralia_id,
       d.provider_id,
       array_remove(array[
           case when d.found_under_slugs && array['neurologo', 'neurocirujano', 'neurofisiologo', 'neurologo-infantil']
                  or exists (select 1 from unnest(d.specializations) s where s ~* '^neuro') then 'neurology' end,
           case when d.found_under_slugs && array['otorrinolaringologo', 'audiologo', 'foniatra']
                  or exists (select 1 from unnest(d.specializations) s where s ~* '(otorrino|audiol|foniat)') then 'otolaryngology' end,
           case when d.found_under_slugs && array['traumatologo', 'ortopedista']
                  or exists (select 1 from unnest(d.specializations) s where s ~* '(traumat|ortoped)') then 'orthopedics' end
       ], null) as add_keys,
       d.entity_type = 'doctor'
         and cardinality(d.specializations) > 0
         and not exists (select 1 from unnest(d.specializations) s
                         where s !~* '(neuro|otorrino|audiol|foniat|traumat|ortoped)') as drop_general
from public.doctoralia_doctors d;

delete from new_specialty_tags where cardinality(add_keys) = 0;

update public.doctoralia_doctors d
set mapped_specialties = (
        select array_agg(distinct k) from unnest(
            case when t.drop_general then array_remove(d.mapped_specialties, 'general') else d.mapped_specialties end
            || t.add_keys) k),
    updated_at = now()
from new_specialty_tags t
where t.doctoralia_id = d.doctoralia_id;

update public.providers p
set specialty = (
        select array_agg(distinct k) from unnest(
            case when t.drop_general then array_remove(p.specialty, 'general') else p.specialty end
            || t.add_keys) k)
from new_specialty_tags t
where t.provider_id = p.id;

-- Google-only listings, by name.
update public.providers p
set specialty = (
        select array_agg(distinct k) from unnest(
            array_remove(p.specialty, 'general')
            || array_remove(array[
                   case when p.name ~* '(neurol|neuroc)' then 'neurology' end,
                   case when p.name ~* 'otorrino' then 'otolaryngology' end,
                   case when p.name ~* '(ortoped|traumat|orthoped)' then 'orthopedics' end
               ], null)) k)
where p."doctoraliaId" is null
  and p.name ~* '(neurol|neuroc|otorrino|ortoped|traumat|orthoped)'
  and p.name !~* '(biomagnet|^ortopedia (calder|del norte|santa fe))';
