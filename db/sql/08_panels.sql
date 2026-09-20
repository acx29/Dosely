-- Dosely sponsored pharmaceutical matches
--
-- Joel's RAG pipeline (Rag/rag_agent.py, saved by db/matcher/write_matches.py) stores its
-- output in the matches table: for each patient the 5 nearest partner drugs by vector
-- similarity, each with its similarity score and the Gemini "why surfaced" text.
-- This file turns those rows into what the screens show:
--
--   sponsored_matches(patient)        the patient's saved matches, best first
--   patient_card_with_panel(patient)  patient_card plus those matches
--   record_panel_view(patient)        writes one panel_shown event per matched drug when a card is opened
--   impiricus_campaigns(days)         per-drug counts for the Impiricus page, aggregates only
--
-- Nothing is filtered or re-ranked here. Order and scores are exactly what the pipeline saved.
--
-- Creates no tables. Safe to run more than once. Plain ASCII only.
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.

-- The single-drug panel from the earlier version is no longer used.
drop function if exists public.sponsored_panel(bigint);
-- This one now returns a count instead of true/false. Postgres cannot change a return type
-- with "create or replace", so the old version is dropped first.
drop function if exists public.record_panel_view(bigint);

create or replace function public.sponsored_matches(p_patient bigint)
returns jsonb
language sql
stable
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'rank', m.rank,
               'drug_id', d.id::text,
               'brand_name', d.brand_name,
               'generic_name', coalesce(d.generic_name, ''),
               'company_name', c.company_name,
               'therapeutic_area', coalesce(d.therapeutic_area, ''),
               'drug_class', coalesce(d.drug_class, ''),
               'indications', to_jsonb(coalesce(d.indications, '{}')),
               'similarity', round(m.similarity::numeric, 4),
               'why_surfaced', m.reason_text,
               'label_url', '/doctor/labels/' || d.id
           ) order by m.rank), '[]'::jsonb)
      from matches m
      join pharma_drugs d     on d.id = m.drug_id
      join pharma_companies c on c.id = d.company_id
     where m.patient_id = p_patient;
$$;

create or replace function public.patient_card_with_panel(p_patient bigint)
returns jsonb
language sql
stable
set search_path = public
as $$
    select case when card is null then null
                else card || jsonb_build_object('sponsored_panel', null,
                                                'sponsored_matches', public.sponsored_matches(p_patient)) end
      from (select public.patient_card(p_patient) as card) x;
$$;

-- One panel_shown event per matched drug, at most once per patient per 30 minutes,
-- so the page's 10-second refresh does not inflate the counts.
create or replace function public.record_panel_view(p_patient bigint)
returns integer
language plpgsql
set search_path = public
as $$
declare
    v_added integer;
begin
    if exists (select 1 from events e where e.patient_id = p_patient and e.type = 'panel_shown' and e.ts > now() - interval '30 minutes') then
        return 0;
    end if;

    insert into events (ts, clinic_name, doctor_id, patient_id, drug_id, condition, type, simulated, meta)
    select now(), d.clinic_name, p.doctor_id, p.id, m.drug_id, p.diagnoses[1], 'panel_shown', false, jsonb_build_object('rank', m.rank)
      from matches m
      join ehr_patients p on p.id = m.patient_id
      join ehr_doctors d  on d.id = p.doctor_id
     where m.patient_id = p_patient;
    get diagnostics v_added = row_count;
    return v_added;
end;
$$;

-- Counts only. No patient, physician or practice identifiers leave this function.
create or replace function public.impiricus_campaigns(p_days integer default 30)
returns jsonb
language sql
stable
set search_path = public
as $$
    with shown as (
        select e.drug_id,
               count(*) as panels_shown,
               count(distinct e.doctor_id) as physicians_reached
          from events e
         where e.type = 'panel_shown' and e.ts <= now() and e.ts > now() - make_interval(days => p_days)
         group by e.drug_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'drug_id', d.id::text,
               'brand_name', d.brand_name,
               'label_name', d.brand_name,
               'manufacturer', c.company_name,
               'therapeutic_area', coalesce(d.therapeutic_area, ''),
               'panels_shown', s.panels_shown,
               'physicians_reached', s.physicians_reached,
               'label_views', (select count(*) from events e where e.type = 'label_viewed' and e.drug_id = d.id
                                  and e.ts <= now() and e.ts > now() - make_interval(days => p_days)),
               -- patients for whom this drug was one of the matches and who booked in the period
               'booked', (select count(distinct e.patient_id) from events e
                           join matches m on m.patient_id = e.patient_id and m.drug_id = d.id
                          where e.type = 'appointment_booked' and e.ts <= now() and e.ts > now() - make_interval(days => p_days))
           ) order by s.panels_shown desc, d.id), '[]'::jsonb)
      from (select * from shown order by panels_shown desc limit 12) s
      join pharma_drugs d     on d.id = s.drug_id
      join pharma_companies c on c.id = d.company_id;
$$;

revoke execute on function public.sponsored_matches(bigint)       from public, anon, authenticated;
revoke execute on function public.patient_card_with_panel(bigint) from public, anon, authenticated;
revoke execute on function public.record_panel_view(bigint)       from public, anon, authenticated;
revoke execute on function public.impiricus_campaigns(integer)    from public, anon, authenticated;
grant  execute on function public.sponsored_matches(bigint)       to service_role;
grant  execute on function public.patient_card_with_panel(bigint) to service_role;
grant  execute on function public.record_panel_view(bigint)       to service_role;
grant  execute on function public.impiricus_campaigns(integer)    to service_role;
