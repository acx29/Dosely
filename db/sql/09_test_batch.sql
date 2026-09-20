-- Dosely: one small test batch before the schedule takes over
--
-- Contacts only the 12 demo patients under Dr. Patel (ids 251 to 262: John Smith, Maria Lopez,
-- Robert Chen and nine others). These are the patients whose RAG matches have Gemini
-- explanations saved, so any booking that results opens into a card with the full matches section.
--
-- The calls play out over 3 minutes. Nobody else at any clinic is contacted by this run.
-- The run is logged with trigger "manual". Every later run comes from the schedule (05_schedule.sql)
-- and is logged with trigger "cron", which contacts the normal batches, oldest overdue first.
--
-- Requires the current 03_recall_job.sql to have been run first (it adds the patient-list setting).
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.

select public.run_recall(
    p_as_of          => now(),
    p_trigger        => 'manual',
    p_window_minutes => 3,
    p_only_patients  => array[251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262]::bigint[]
) as test_batch;

-- What each of the 12 is planned to end up as. The screens reveal it step by step over the 3 minutes.
select p.id, p.first_name || ' ' || p.last_name as patient, o.channel, o.status as planned_outcome,
       to_char(a.appointment_date at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM') as booked_for
  from public.outreach o
  join public.ehr_patients p on p.id = o.patient_id
  left join public.ehr_appointments a on a.outreach_id = o.id
 where o.recall_run_id = (select max(id) from public.recall_runs)
 order by p.id;
