-- Dosely: reset to a clean start
--
-- Puts the database back to "the agent has never run":
--   1. restores the follow-up dates of every patient whose dates a completed recall visit had moved
--   2. frees the appointment slots the agent had booked
--   3. deletes everything the recall job wrote: events, outreach, runs, call summaries, texts,
--      action items, and the agent's bookings
--   4. restarts the id counters, so the first scheduled run is run 1
--
-- It keeps: every patient, doctor and drug, the open slots, the practice's own calendar
-- appointments (the grey blocks on the Schedule), and any on-hold flags.
-- After this, every dashboard number is 0 until the scheduled job runs.
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.

-- 1. Patients whose visit was marked completed had last_appointment and next_followup_due moved
--    forward. The original due date was recorded in the patient's first "found" event.
with moved as (
    select distinct on (a.patient_id) a.patient_id, (e.meta->>'due')::date as original_due
      from public.ehr_appointments a
      join public.events e on e.patient_id = a.patient_id and e.type = 'patient_flagged' and e.meta ? 'due'
     where a.source = 'dosely' and a.status = 'completed'
     order by a.patient_id, e.ts asc
)
update public.ehr_patients p
   set next_followup_due = m.original_due,
       last_appointment  = (m.original_due - make_interval(months => coalesce(p.recommended_followup_months, 6)))::date
  from moved m
 where p.id = m.patient_id;

-- 2. Free the slots held by the agent's bookings.
update public.ehr_slots s
   set booked_by_patient_id = null
  from public.ehr_appointments a
 where a.slot_id = s.id and a.source = 'dosely';

-- 3. Delete what the job wrote, children before parents.
delete from public.call_summaries;
delete from public.sms_messages;
delete from public.action_items;
delete from public.ehr_appointments where source = 'dosely';
delete from public.outreach;
delete from public.recall_runs;
delete from public.events;

-- 4. Restart the id counters.
alter table public.recall_runs alter column id restart with 1;
alter table public.outreach    alter column id restart with 1;
alter table public.events      alter column id restart with 1;

select 'events'                          as what, count(*)::text as value from public.events
union all select 'runs',                  count(*)::text from public.recall_runs
union all select 'outreach',              count(*)::text from public.outreach
union all select 'agent bookings',        count(*)::text from public.ehr_appointments where source = 'dosely'
union all select 'practice appointments kept', count(*)::text from public.ehr_appointments where source = 'practice'
union all select 'patients overdue now',  count(*)::text from public.ehr_patients where next_followup_due < current_date
union all select 'open slots',            count(*)::text from public.ehr_slots where booked_by_patient_id is null and starts_at > now();
