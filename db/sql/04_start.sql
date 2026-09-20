-- Dosely: prepare the calendar
--
-- Run this once, after 03_recall_job.sql. It does NOT run the recall job and builds NO history,
-- so every dashboard number stays 0 until the scheduled job (05_schedule.sql) first runs.
--   1. opens appointment slots for every provider for the next 28 days
--   2. fills about a third of the demo practice's calendar with its own existing appointments
--
-- Running it again is harmless: each step skips work that already exists.
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.
--
-- Optional, NOT part of a clean start: "select public.backfill_recall(90);" replays the job once
-- per past weekday to generate 90 days of history.

select public.ensure_slots(current_date, 28)  as slots_added;
select public.seed_practice_calendar()        as practice_appointments_added;
