-- Dosely metrics functions
--
-- What this does: adds one read-only function the web app calls to fill the
-- Practice performance screen. It creates no tables and changes no rows.
-- Safe to run more than once ("create or replace").
--
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.
--
-- Every number is a count over the events table, limited to one clinic and to
-- events whose timestamp is not in the future (ts <= now()). The recall job stamps
-- events a few minutes ahead, so that filter is what makes the screen move
-- minute by minute.

create or replace function public.doctor_metrics(p_clinic text, p_days integer default 90)
returns jsonb
language sql
stable
set search_path = public
as $$
    with e as (
        select patient_id, type, condition
          from events
         where clinic_name = p_clinic
           and ts <= now()
           and ts >  now() - make_interval(days => p_days)
    ),
    by_condition as (
        select coalesce(condition, 'Other') as condition,
               count(distinct patient_id) filter (where type = 'patient_flagged')    as overdue,
               count(distinct patient_id) filter (where type = 'appointment_booked') as booked,
               count(distinct patient_id) filter (where type = 'visit_completed')    as seen
          from e
         group by 1
        having count(distinct patient_id) filter (where type = 'patient_flagged') > 0
         order by 2 desc, 1
         limit 8
    ),
    needs_attention as (
        select p.first_name || ' ' || p.last_name as patient, a.text as reason
          from action_items a
          join ehr_patients p on p.id = a.patient_id
          join ehr_doctors  d on d.id = p.doctor_id
         where d.clinic_name = p_clinic
           and a.resolved_at is null
           and a.created_at <= now()
         order by a.created_at desc
         limit 5
    )
    select jsonb_build_object(
        'found',     (select count(distinct patient_id) from e where type = 'patient_flagged'),
        'contacted', (select count(distinct patient_id) from e where type in ('call_placed', 'sms_sent')),
        'booked',    (select count(distinct patient_id) from e where type = 'appointment_booked'),
        'seen',      (select count(distinct patient_id) from e where type = 'visit_completed'),
        'by_condition',    coalesce((select jsonb_agg(to_jsonb(b)) from by_condition b), '[]'::jsonb),
        'needs_attention', coalesce((select jsonb_agg(to_jsonb(n)) from needs_attention n), '[]'::jsonb)
    );
$$;

-- Only the secret key (service_role) may call it. The publishable key may not.
revoke execute on function public.doctor_metrics(text, integer) from public;
revoke execute on function public.doctor_metrics(text, integer) from anon, authenticated;
grant  execute on function public.doctor_metrics(text, integer) to service_role;
