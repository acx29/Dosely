-- Dosely recall job
--
-- What this adds:
--   dosely_u(seed)              repeatable pseudo-random number in [0, 1) from a text seed
--   ensure_slots(from, days)    open appointment times for every provider
--   seed_practice_calendar(c)   the demo practice's existing (non-Dosely) appointments
--   run_recall(...)             ONE run of the recall agent. The scheduler calls this.
--   backfill_recall(days)       builds history by calling run_recall once per past weekday
--   outreach_now                view: each outreach with its status as of this minute
--
-- It creates no tables. Safe to run more than once ("create or replace").
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.
--
-- How one run works:
--   1. Settle visits whose time has passed: 84% completed, the rest no-show. A completed
--      visit moves the patient's last_appointment and next_followup_due, so they stop being overdue.
--   2. Close outreach that went nowhere for 45 days, so the patient can be contacted again.
--   3. Find: every patient whose due date is before the run date. Count who is skipped and why.
--      Write one patient_flagged event per newly found patient.
--   4. Pick a batch per clinic, oldest due date first.
--   5. For each picked patient, decide the outcome from a hash of patient id and run id, so the
--      same run always gives the same result. Write every event with the timestamp at which it
--      happens, spread across the run window. Timestamps can be in the future. Screens only
--      read rows with ts <= now(), so the activity appears minute by minute.
--
-- No real phone is involved. Real calls for whitelisted demo phones write to the same tables.


-- ------------------------------------------------------------------
-- Repeatable pseudo-random number from a seed string
-- ------------------------------------------------------------------

create or replace function public.dosely_u(seed text)
returns double precision
language sql
immutable
as $$
    select (('x' || substr(md5(seed), 1, 8))::bit(32)::bigint)::double precision / 4294967296.0
$$;


-- ------------------------------------------------------------------
-- One helper so every event insert has the same columns
-- ------------------------------------------------------------------

create or replace function public.dosely_event(
    p_ts timestamptz, p_clinic text, p_doctor bigint, p_patient bigint, p_outreach bigint,
    p_condition text, p_type text, p_run bigint, p_meta jsonb default '{}'::jsonb)
returns void
language sql
set search_path = public
as $$
    insert into events (ts, clinic_name, doctor_id, patient_id, outreach_id, condition, type, recall_run_id, simulated, meta)
    values (p_ts, p_clinic, p_doctor, p_patient, p_outreach, p_condition, p_type, p_run, true, p_meta)
$$;


-- ------------------------------------------------------------------
-- Open appointment times: weekdays, 8:00 AM to 4:30 PM Eastern, every 30 minutes
-- ------------------------------------------------------------------

create or replace function public.ensure_slots(p_from date default current_date, p_days integer default 28)
returns integer
language plpgsql
set search_path = public
as $$
declare
    v_added integer;
begin
    -- step 0 is 8:00 AM, step 17 is 4:30 PM. Postgres has no generate_series for times of day,
    -- so the half-hour steps are counted as integers.
    insert into ehr_slots (doctor_id, starts_at, ends_at)
    select d.id,
           ((p_from + day_n + time '08:00' + make_interval(mins => 30 * step)) at time zone 'America/New_York'),
           ((p_from + day_n + time '08:00' + make_interval(mins => 30 * step + 30)) at time zone 'America/New_York')
      from ehr_doctors d
     cross join generate_series(0, p_days - 1) as day_n
     cross join generate_series(0, 17) as step
     where extract(isodow from p_from + day_n) < 6
    on conflict (doctor_id, starts_at) do nothing;
    get diagnostics v_added = row_count;
    return v_added;
end;
$$;


-- ------------------------------------------------------------------
-- The demo practice's own calendar: about a third of its slots are already taken by
-- appointments the practice booked itself. These show as grey blocks on the Schedule.
-- Does nothing if that practice already has practice-booked appointments.
-- ------------------------------------------------------------------

create or replace function public.seed_practice_calendar(p_clinic text default 'Joel''s Clinic')
returns integer
language plpgsql
set search_path = public
as $$
declare
    v_added integer;
begin
    if exists (select 1 from ehr_appointments a join ehr_doctors d on d.id = a.doctor_id
                where d.clinic_name = p_clinic and a.source = 'practice') then
        return 0;
    end if;

    with taken as (
        select s.id as slot_id, s.doctor_id, s.starts_at,
               row_number() over (partition by s.doctor_id order by s.starts_at) as n
          from ehr_slots s
          join ehr_doctors d on d.id = s.doctor_id
         where d.clinic_name = p_clinic
           and s.booked_by_patient_id is null
           and s.starts_at > now()
           and dosely_u('calendar:' || s.id) < 0.35
    ),
    people as (
        -- Patients of the same provider who are not overdue, so they are not recall targets.
        select p.id as patient_id, p.doctor_id,
               row_number() over (partition by p.doctor_id order by p.id) as n
          from ehr_patients p
          join ehr_doctors d on d.id = p.doctor_id
         where d.clinic_name = p_clinic and p.next_followup_due >= current_date
    ),
    paired as (
        select t.slot_id, t.doctor_id, t.starts_at, pe.patient_id
          from taken t join people pe on pe.doctor_id = t.doctor_id and pe.n = t.n
    ),
    booked as (
        update ehr_slots s set booked_by_patient_id = pa.patient_id
          from paired pa where s.id = pa.slot_id
        returning s.id
    )
    insert into ehr_appointments (patient_id, doctor_id, slot_id, appointment_date, appointment_type, status, source, review_state, created_at)
    select pa.patient_id, pa.doctor_id, pa.slot_id, pa.starts_at,
           (array['Follow-up', 'Follow-up', 'Follow-up', 'Annual physical', 'New patient', 'Telehealth', 'Procedure'])
               [1 + floor(dosely_u('kind:' || pa.slot_id) * 7)::int],
           'scheduled', 'practice', 'kept', now() - interval '14 days'
      from paired pa
     where exists (select 1 from booked b where b.id = pa.slot_id);
    get diagnostics v_added = row_count;
    return v_added;
end;
$$;


-- ------------------------------------------------------------------
-- Booking. Claims a real open slot, or for history older than today invents a past time.
-- Returns false when the provider has no open time.
-- ------------------------------------------------------------------

create or replace function public.dosely_book(
    p_outreach bigint, p_patient bigint, p_doctor bigint, p_clinic text, p_condition text,
    p_run bigint, p_book_ts timestamptz, p_via text, p_key text,
    p_first_name text, p_sms_ok boolean, p_clinic_phone text)
returns boolean
language plpgsql
set search_path = public
as $$
declare
    v_slot_id bigint;
    v_start   timestamptz;
    v_appt_id bigint;
    v_day     date;
begin
    if p_book_ts < now() - interval '13 days' then
        -- History: the visit is already in the past, so no live slot is involved.
        v_day := (p_book_ts at time zone 'America/New_York')::date + (3 + floor(dosely_u('hday:' || p_key) * 9))::int;
        if extract(isodow from v_day) = 6 then v_day := v_day + 2; end if;
        if extract(isodow from v_day) = 7 then v_day := v_day + 1; end if;
        v_start := (v_day + time '08:00' + make_interval(mins => 30 * floor(dosely_u('htime:' || p_key) * 17)::int)) at time zone 'America/New_York';
    else
        -- Spread bookings over the provider's next open times instead of always taking the first.
        select s.id, s.starts_at into v_slot_id, v_start
          from ehr_slots s
         where s.doctor_id = p_doctor and s.booked_by_patient_id is null
           and s.starts_at > greatest(p_book_ts, now()) + interval '18 hours'
         order by s.starts_at
        offset floor(dosely_u('slot:' || p_key) * 24)::int
         limit 1
           for update skip locked;

        if v_slot_id is null then
            select s.id, s.starts_at into v_slot_id, v_start
              from ehr_slots s
             where s.doctor_id = p_doctor and s.booked_by_patient_id is null
               and s.starts_at > greatest(p_book_ts, now()) + interval '18 hours'
             order by s.starts_at limit 1 for update skip locked;
        end if;
        if v_slot_id is null then
            return false;
        end if;
        update ehr_slots set booked_by_patient_id = p_patient where id = v_slot_id;
    end if;

    insert into ehr_appointments (patient_id, doctor_id, slot_id, outreach_id, appointment_date, status, source, review_state, created_at, updated_at)
    values (p_patient, p_doctor, v_slot_id, p_outreach, v_start, 'scheduled', 'dosely', 'new', p_book_ts, p_book_ts)
    returning id into v_appt_id;

    update call_summaries set appointment_id = v_appt_id where outreach_id = p_outreach;

    perform dosely_event(p_book_ts, p_clinic, p_doctor, p_patient, p_outreach, p_condition, 'appointment_booked', p_run,
                         jsonb_build_object('via', p_via, 'starts_at', v_start, 'appointment_id', v_appt_id));

    if p_sms_ok then
        insert into sms_messages (outreach_id, patient_id, direction, kind, body, status, simulated, at)
        values (p_outreach, p_patient, 'out', 'confirmation',
                format('Your appointment with %s is confirmed for %s. Reply C to cancel or call %s to reschedule.',
                       p_clinic, to_char(v_start at time zone 'America/New_York', 'Dy, Mon FMDD "at" FMHH12:MI AM'), p_clinic_phone),
                'delivered', true, p_book_ts + interval '5 seconds');
        perform dosely_event(p_book_ts + interval '5 seconds', p_clinic, p_doctor, p_patient, p_outreach, p_condition, 'confirmation_sent', p_run);
    end if;
    return true;
end;
$$;


-- ------------------------------------------------------------------
-- One run of the recall agent
-- ------------------------------------------------------------------

-- The earlier version took five settings. Adding a sixth creates a second function with the same
-- name, and a plain "run_recall()" call could then not tell them apart. Drop the old one first.
drop function if exists public.run_recall(timestamptz, text, integer, integer, integer);

create or replace function public.run_recall(
    p_as_of          timestamptz default now(),
    p_trigger        text        default 'cron',
    p_window_minutes integer     default 30,   -- calls are spread across this many minutes
    p_demo_batch     integer     default 12,   -- patients contacted per run at the demo practice
    p_other_batch    integer     default 4,    -- patients contacted per run at every other practice
    p_only_patients  bigint[]    default null) -- when given, contact exactly these patients (if eligible) and nobody else
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    -- Settings. Change a number here and re-run this file.
    c_demo_clinic    constant text := 'Joel''s Clinic';
    c_clinic_phone   constant text := '(555) 014-9000';
    c_accept_rate    constant double precision := 0.20;  -- answers the call and books
    c_decline_rate   constant double precision := 0.10;  -- answers and declines
    c_fail_rate      constant double precision := 0.05;  -- call fails twice
                                                         -- everyone else: no answer or busy, then a text
    c_reply_rate     constant double precision := 0.25;  -- of texted patients: reply YES and book
    c_show_rate      constant double precision := 0.84;  -- of booked visits: the patient shows up
    c_question_rate  constant double precision := 0.15;  -- of booked calls: patient asks staff a question
    c_recontact_days constant integer := 45;

    v_run_id   bigint;
    v_today    date := (p_as_of at time zone 'America/New_York')::date;
    v_found    integer := 0;
    v_created  integer := 0;
    v_booked   integer := 0;
    v_counts   record;
    a          record;
    r          record;
    v_key      text;
    v_batch    integer;
    v_gap      double precision;
    t0         timestamptz;
    t          timestamptz;
    v_u        double precision;
    v_out      bigint;
    v_final    text;
    v_sms_ok   boolean;
    v_call_ok  boolean;
    v_ok       boolean;
    v_question text;
    v_dur      integer;
    v_responses text[] := array['Agreed right away. No questions.', 'Asked for a morning time.',
                                'Preferred the earliest available day.', 'Confirmed and asked for a text reminder.'];
    v_questions text[] := array['Do I need to fast for labs before I come in?', 'Can I bring a family member to the visit?',
                                'Should I bring my home blood pressure readings?', 'Is there parking near the entrance?',
                                'Can my prescriptions be refilled at this visit?'];
begin
    insert into recall_runs (as_of, trigger) values (p_as_of, p_trigger) returning id into v_run_id;

    -- 1. Settle visits whose time has passed.
    for a in
        select ap.id, ap.patient_id, ap.doctor_id, ap.outreach_id, ap.appointment_date, o.clinic_name,
               p.diagnoses[1] as condition, coalesce(p.recommended_followup_months, 6) as months
          from ehr_appointments ap
          join outreach o     on o.id = ap.outreach_id
          join ehr_patients p on p.id = ap.patient_id
         where ap.status = 'scheduled' and ap.source = 'dosely'
           and ap.appointment_date + interval '30 minutes' <= p_as_of
    loop
        if dosely_u('show:' || a.id) < c_show_rate then
            update ehr_appointments set status = 'completed', updated_at = a.appointment_date + interval '30 minutes' where id = a.id;
            update ehr_patients
               set last_appointment  = (a.appointment_date at time zone 'America/New_York')::date,
                   next_followup_due = ((a.appointment_date at time zone 'America/New_York')::date + make_interval(months => a.months))::date
             where id = a.patient_id;
            update outreach set status = 'seen', updated_at = a.appointment_date + interval '30 minutes' where id = a.outreach_id;
            perform dosely_event(a.appointment_date + interval '30 minutes', a.clinic_name, a.doctor_id, a.patient_id, a.outreach_id, a.condition, 'visit_completed', v_run_id);
        else
            update ehr_appointments set status = 'no_show', updated_at = a.appointment_date + interval '30 minutes' where id = a.id;
            update outreach set status = 'no_show', updated_at = a.appointment_date + interval '30 minutes' where id = a.outreach_id;
            perform dosely_event(a.appointment_date + interval '30 minutes', a.clinic_name, a.doctor_id, a.patient_id, a.outreach_id, a.condition, 'visit_no_show', v_run_id);
        end if;
    end loop;

    -- 2. Close outreach that went nowhere, so those patients can be contacted again.
    update outreach set status = 'closed', updated_at = p_as_of
     where status in ('queued', 'calling', 'text_sent')
       and created_at < p_as_of - make_interval(days => c_recontact_days);

    -- 3. Find. Count every overdue patient and why any were passed over.
    select count(*)                                                                           as overdue_total,
           count(*) filter (where not (coalesce(p.consent_for_calls, false) or coalesce(p.consent_for_sms, false))) as no_consent,
           count(*) filter (where p.on_hold)                                                  as on_hold,
           count(*) filter (where p.do_not_contact)                                           as dnc,
           count(*) filter (where exists (select 1 from outreach o where o.patient_id = p.id
                                           and o.created_at > p_as_of - make_interval(days => c_recontact_days))) as already_open
      into v_counts
      from ehr_patients p
     where p.next_followup_due < v_today;

    insert into events (ts, clinic_name, doctor_id, patient_id, condition, type, recall_run_id, simulated, meta)
    select p_as_of, d.clinic_name, p.doctor_id, p.id, p.diagnoses[1], 'patient_flagged', v_run_id, true,
           jsonb_build_object('due', p.next_followup_due, 'days_overdue', v_today - p.next_followup_due)
      from ehr_patients p
      join ehr_doctors d on d.id = p.doctor_id
     where p.next_followup_due < v_today
       and (coalesce(p.consent_for_calls, false) or coalesce(p.consent_for_sms, false))
       and not p.on_hold and not p.do_not_contact
       and not exists (select 1 from events e where e.patient_id = p.id and e.type = 'patient_flagged'
                          and e.ts > p_as_of - interval '180 days');
    get diagnostics v_found = row_count;

    -- 4 and 5. Pick the batch per clinic, oldest due date first, and play out each contact.
    for r in
        with eligible as (
            select p.id, p.doctor_id, p.first_name, p.diagnoses[1] as condition,
                   coalesce(p.consent_for_calls, false) as call_ok, coalesce(p.consent_for_sms, false) as sms_ok,
                   d.clinic_name,
                   -- Patients never contacted go first. Within that, oldest due date first.
                   row_number() over (partition by d.clinic_name
                                      order by (select count(*) from outreach o2 where o2.patient_id = p.id),
                                               p.next_followup_due, p.id) as rk
              from ehr_patients p
              join ehr_doctors d on d.id = p.doctor_id
             where p.next_followup_due < v_today
               and (coalesce(p.consent_for_calls, false) or coalesce(p.consent_for_sms, false))
               and not p.on_hold and not p.do_not_contact
               and not exists (select 1 from outreach o where o.patient_id = p.id
                                  and (o.created_at > p_as_of - make_interval(days => c_recontact_days)
                                       or o.status in ('queued', 'calling', 'text_sent', 'booked')))
               and not exists (select 1 from ehr_appointments ap where ap.patient_id = p.id
                                  and ap.status = 'scheduled' and ap.appointment_date > p_as_of)
               -- A targeted run looks only at the listed patients. The same eligibility rules still apply to them.
               and (p_only_patients is null or p.id = any(p_only_patients))
        )
        select * from eligible
         where rk <= case when p_only_patients is not null then cardinality(p_only_patients)
                          when clinic_name = c_demo_clinic then p_demo_batch else p_other_batch end
         order by clinic_name, rk
    loop
        v_key    := r.id || ':' || v_run_id;
        v_batch  := case when p_only_patients is not null then cardinality(p_only_patients)
                         when r.clinic_name = c_demo_clinic then p_demo_batch else p_other_batch end;
        v_gap    := (p_window_minutes * 60.0) / greatest(v_batch, 1);
        t0       := p_as_of + make_interval(secs => 15 + (r.rk - 1) * v_gap + dosely_u('jitter:' || v_key) * v_gap * 0.7);
        v_sms_ok := r.sms_ok;
        v_call_ok := r.call_ok;
        v_u      := dosely_u('outcome:' || v_key);
        v_question := null;

        insert into outreach (patient_id, doctor_id, clinic_name, recall_run_id, channel, status, simulated, created_at, updated_at)
        values (r.id, r.doctor_id, r.clinic_name, v_run_id, case when v_call_ok then 'voice' else 'sms' end, 'queued', true, p_as_of, p_as_of)
        returning id into v_out;
        v_created := v_created + 1;
        perform dosely_event(p_as_of, r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'outreach_queued', v_run_id);

        v_final := 'text_sent';
        t := t0;

        if v_call_ok then
            perform dosely_event(t, r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'call_placed', v_run_id);

            if v_u < c_accept_rate then
                -- Answers, verifies, books on the call.
                perform dosely_event(t + interval '9 seconds',  r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'call_answered', v_run_id);
                perform dosely_event(t + interval '26 seconds', r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'identity_verified', v_run_id);
                v_dur := 58 + floor(dosely_u('dur:' || v_key) * 50)::int;
                if dosely_u('question:' || v_key) < c_question_rate then
                    v_question := v_questions[1 + floor(dosely_u('which:' || v_key) * array_length(v_questions, 1))::int];
                end if;
                insert into call_summaries (outreach_id, contact_result, identity_verified, patient_response, patient_question,
                                            followup_required, duration_seconds, call_started_at)
                values (v_out, 'answered', true,
                        case when v_question is null then v_responses[1 + floor(dosely_u('resp:' || v_key) * array_length(v_responses, 1))::int]
                             else 'Booked. Asked a question for clinic staff.' end,
                        v_question, v_question is not null, v_dur, t + interval '9 seconds');

                v_ok := dosely_book(v_out, r.id, r.doctor_id, r.clinic_name, r.condition, v_run_id,
                                    t + make_interval(secs => v_dur - 12), 'call', v_key, r.first_name, v_sms_ok, c_clinic_phone);
                if v_ok then
                    v_final := 'booked';
                    v_booked := v_booked + 1;
                    if v_question is not null then
                        perform dosely_event(t + make_interval(secs => v_dur - 20), r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'escalated', v_run_id,
                                             jsonb_build_object('source', 'call'));
                        insert into action_items (patient_id, outreach_id, text, created_at)
                        values (r.id, v_out, format('Asked on the call: "%s"', v_question), t + make_interval(secs => v_dur - 20));
                    end if;
                else
                    v_final := 'needs_attention';
                    perform dosely_event(t + make_interval(secs => v_dur), r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'escalated', v_run_id,
                                         jsonb_build_object('final', true, 'reason', 'no_open_times'));
                    insert into action_items (patient_id, outreach_id, text, created_at)
                    values (r.id, v_out, 'Wants a follow-up but the provider had no open times to offer.', t + make_interval(secs => v_dur));
                end if;

            elsif v_u < c_accept_rate + c_decline_rate then
                perform dosely_event(t + interval '9 seconds',  r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'call_answered', v_run_id);
                perform dosely_event(t + interval '26 seconds', r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'identity_verified', v_run_id);
                perform dosely_event(t + interval '44 seconds', r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'declined', v_run_id);
                insert into call_summaries (outreach_id, contact_result, identity_verified, patient_response, duration_seconds, call_started_at)
                values (v_out, 'answered', true, 'Declined to schedule for now.', 44, t + interval '9 seconds');
                v_final := 'declined';

            elsif v_u >= 1 - c_fail_rate then
                -- Fails, one retry, fails again.
                perform dosely_event(t + interval '20 seconds',  r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'call_failed', v_run_id);
                perform dosely_event(t + interval '200 seconds', r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'call_placed', v_run_id);
                perform dosely_event(t + interval '220 seconds', r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'call_failed', v_run_id,
                                     jsonb_build_object('final', true));
                insert into call_summaries (outreach_id, contact_result, patient_response, call_started_at)
                values (v_out, 'failed', 'Not reached', t);
                insert into action_items (patient_id, outreach_id, text, created_at)
                values (r.id, v_out, case when v_sms_ok then 'Call failed twice.' else 'Call failed twice. No text consent on file.' end,
                        t + interval '220 seconds');
                v_final := 'needs_attention';

            else
                -- No answer, or busy for the top slice of this range.
                perform dosely_event(t + interval '35 seconds', r.clinic_name, r.doctor_id, r.id, v_out, r.condition,
                                     case when v_u > 0.85 then 'call_busy' else 'call_no_answer' end, v_run_id);
                insert into call_summaries (outreach_id, contact_result, patient_response, call_started_at)
                values (v_out, case when v_u > 0.85 then 'busy' else 'no_answer' end, 'No response yet', t);
                t := t + interval '45 seconds';
                if not v_sms_ok then
                    perform dosely_event(t, r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'escalated', v_run_id,
                                         jsonb_build_object('final', true, 'reason', 'no_text_consent'));
                    insert into action_items (patient_id, outreach_id, text, created_at)
                    values (r.id, v_out, 'No answer. No text consent on file.', t);
                    v_final := 'needs_attention';
                end if;
            end if;
        end if;

        -- Text path: reached by no answer or busy, or directly when there is no call consent.
        if v_final = 'text_sent' then
            insert into sms_messages (outreach_id, patient_id, direction, kind, body, status, simulated, at)
            values (v_out, r.id, 'out', 'fallback',
                    format('Hi %s, this is %s. We''re reaching out about scheduling your next appointment. Reply YES for help booking, or call %s.',
                           r.first_name, r.clinic_name, c_clinic_phone), 'delivered', true, t);
            perform dosely_event(t, r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'sms_sent', v_run_id, jsonb_build_object('kind', 'fallback'));

            if dosely_u('reply:' || v_key) < c_reply_rate then
                t := t + make_interval(mins => 4 + floor(dosely_u('delay:' || v_key) * 80)::int);
                insert into sms_messages (outreach_id, patient_id, direction, kind, body, status, simulated, at)
                values (v_out, r.id, 'in', 'reply', 'YES', 'received', true, t);
                perform dosely_event(t, r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'sms_reply', v_run_id, jsonb_build_object('intent', 'yes'));

                t := t + interval '20 seconds';
                insert into sms_messages (outreach_id, patient_id, direction, kind, body, status, simulated, at)
                values (v_out, r.id, 'out', 'slot_options',
                        format('%s has open times this week and next. Reply 1, 2 or 3 to pick one, or call %s.', r.clinic_name, c_clinic_phone),
                        'delivered', true, t);
                perform dosely_event(t, r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'sms_sent', v_run_id, jsonb_build_object('kind', 'slot_options'));

                t := t + make_interval(mins => 2 + floor(dosely_u('pick:' || v_key) * 9)::int);
                insert into sms_messages (outreach_id, patient_id, direction, kind, body, status, simulated, at)
                values (v_out, r.id, 'in', 'reply', (1 + floor(dosely_u('choice:' || v_key) * 3))::int::text, 'received', true, t);
                perform dosely_event(t, r.clinic_name, r.doctor_id, r.id, v_out, r.condition, 'sms_reply', v_run_id, jsonb_build_object('intent', 'pick'));

                update call_summaries set patient_response = 'Replied YES by text and picked a time.' where outreach_id = v_out;
                v_ok := dosely_book(v_out, r.id, r.doctor_id, r.clinic_name, r.condition, v_run_id,
                                    t + interval '5 seconds', 'text', v_key, r.first_name, true, c_clinic_phone);
                if v_ok then
                    v_final := 'booked';
                    v_booked := v_booked + 1;
                end if;
            end if;
        end if;

        update outreach set status = v_final, updated_at = t where id = v_out;
    end loop;

    update recall_runs
       set overdue_total = v_counts.overdue_total, patients_found = v_found, outreach_created = v_created,
           skipped_no_consent = v_counts.no_consent, skipped_on_hold = v_counts.on_hold,
           skipped_do_not_contact = v_counts.dnc, skipped_already_open = v_counts.already_open,
           detail = jsonb_build_object('booked_in_this_run', v_booked, 'window_minutes', p_window_minutes),
           finished_at = clock_timestamp()
     where id = v_run_id;

    return jsonb_build_object('run_id', v_run_id, 'as_of', p_as_of, 'overdue_total', v_counts.overdue_total,
                              'found', v_found, 'contacted', v_created, 'booked', v_booked);
end;
$$;


-- ------------------------------------------------------------------
-- History: one run per past weekday, calls spread across that working day.
-- Uses smaller batches than live runs so most overdue patients are left for the live job.
-- Refuses to run twice.
-- ------------------------------------------------------------------

create or replace function public.backfill_recall(
    p_days integer default 90, p_demo_batch integer default 10, p_other_batch integer default 2)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    d      integer;
    v_day  date;
    v_runs integer := 0;
begin
    if exists (select 1 from recall_runs where trigger = 'backfill') then
        return jsonb_build_object('skipped', 'history already exists');
    end if;
    for d in reverse p_days .. 1 loop
        v_day := current_date - d;
        if extract(isodow from v_day) < 6 then
            perform run_recall((v_day + time '09:00') at time zone 'America/New_York', 'backfill', 480, p_demo_batch, p_other_batch);
            v_runs := v_runs + 1;
        end if;
    end loop;
    return jsonb_build_object('history_runs', v_runs);
end;
$$;


-- ------------------------------------------------------------------
-- Status of each outreach as of this minute, from the latest event that has already happened.
-- security_invoker makes the view obey row level security for whoever queries it.
-- ------------------------------------------------------------------

create or replace view public.outreach_now
with (security_invoker = true)
as
select o.id, o.patient_id, o.doctor_id, o.clinic_name, o.recall_run_id, o.channel, o.simulated, o.created_at,
       coalesce(latest.status_now, 'queued') as status_now,
       latest.ts as last_event_at
  from outreach o
  left join lateral (
      select e.ts,
             case
                 when e.type = 'outreach_queued' then 'queued'
                 when e.type in ('call_placed', 'call_answered', 'identity_verified', 'call_no_answer', 'call_busy') then 'calling'
                 when e.type = 'call_failed' then case when e.meta->>'final' = 'true' then 'needs_attention' else 'calling' end
                 when e.type in ('sms_sent', 'sms_reply') then 'text_sent'
                 when e.type in ('appointment_booked', 'confirmation_sent', 'booking_kept', 'appointment_rescheduled', 'appointment_reassigned') then 'booked'
                 when e.type = 'declined' then 'declined'
                 when e.type in ('escalated', 'appointment_cancelled') then 'needs_attention'
                 when e.type = 'visit_completed' then 'seen'
                 when e.type = 'visit_no_show' then 'no_show'
             end as status_now
        from events e
       where e.outreach_id = o.id
         and e.ts <= now()
         and (e.type <> 'escalated' or e.meta->>'final' = 'true')   -- a question on a booked call does not change the status
       order by e.ts desc, e.id desc
       limit 1
  ) latest on true
 where o.created_at <= now();


-- ------------------------------------------------------------------
-- Only the secret key (service_role) and scheduled database jobs may run these.
-- ------------------------------------------------------------------

revoke execute on function public.run_recall(timestamptz, text, integer, integer, integer, bigint[]) from public, anon, authenticated;
revoke execute on function public.backfill_recall(integer, integer, integer)               from public, anon, authenticated;
revoke execute on function public.ensure_slots(date, integer)                              from public, anon, authenticated;
revoke execute on function public.seed_practice_calendar(text)                             from public, anon, authenticated;
revoke execute on function public.dosely_book(bigint, bigint, bigint, text, text, bigint, timestamptz, text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.dosely_event(timestamptz, text, bigint, bigint, bigint, text, text, bigint, jsonb) from public, anon, authenticated;
grant  execute on function public.run_recall(timestamptz, text, integer, integer, integer, bigint[]) to service_role;
grant  execute on function public.backfill_recall(integer, integer, integer)               to service_role;
grant  execute on function public.ensure_slots(date, integer)                              to service_role;
grant  execute on function public.seed_practice_calendar(text)                             to service_role;
revoke all on public.outreach_now from anon, authenticated;
grant  select on public.outreach_now to service_role;
