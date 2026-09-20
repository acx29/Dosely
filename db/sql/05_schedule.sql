-- Dosely: run the recall job every 30 minutes
--
-- Uses pg_cron, the scheduler built into Supabase. The job runs inside the database, so it
-- keeps running with every laptop closed.
--
-- Kept in its own file on purpose: if enabling the scheduler fails, nothing else is affected.
-- If the first statement errors, enable it in the dashboard instead
-- (Integrations > Cron > Enable), then run this file again.
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.

create extension if not exists pg_cron with schema pg_catalog;

-- "*/30 * * * *" means minute 0 and minute 30 of every hour, every day.
-- Scheduling under a name that already exists replaces that job, so re-running is safe.
-- Each tick tops up the 28-day slot horizon, records today's physician app opens once
-- (a no-op after the first tick of the day), then does one recall run.
-- Requires 03_recall_job.sql and 06_screen_functions.sql to have been run first.
select cron.schedule(
    'dosely-recall',
    '*/30 * * * *',
    $$ select public.ensure_slots(current_date, 28); select public.simulate_opens(current_date); select public.run_recall(); $$
);

-- What is scheduled now:
select jobid, jobname, schedule, active from cron.job where jobname = 'dosely-recall';

-- To see whether each tick ran:   select * from cron.job_run_details order by start_time desc limit 10;
-- To stop it:                     select cron.unschedule('dosely-recall');
