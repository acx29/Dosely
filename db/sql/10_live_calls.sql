-- Dosely live calls
--
-- The recall job (03_recall_job.sql) plays out every contact inside the database and touches no
-- phone. This file adds the other path: a real outbound call placed through the ElevenLabs API.
-- Both paths write the same tables and the same event types, so every screen shows a live call
-- the same way it shows a simulated one. Rows written here carry simulated = false.
--
-- What starts a real call: the Call button on a Queued row of the Recall activity screen.
-- "Run recall now" never dials.
--
-- Which phone rings: only ever a number listed in DEMO_PHONE_WHITELIST (web/.env.local). The web
-- route dials the patient's stored phone if it is in that list, otherwise the first number in the
-- list. The phone shown for a patient on screen is therefore not necessarily the one that rings.
--
-- Order of calls for one live patient (the web routes under web/app/api/ call these):
--   live_patient_ids(phones, clinic)      which patients have a whitelisted phone (skipped by "Run recall now")
--   start_live_call(patient, live)        the Call button: creates the outreach row, status queued
--   live_call_placed(outreach, sid, conv) ElevenLabs accepted the call           -> Calling
--   live_call_failed(outreach, reason)    ElevenLabs rejected the call           -> Needs attention
--   live_verify_patient(...)              agent tool: date of birth check
--   live_available_slots(...)             agent tool: three open times
--   live_book(...)                        agent tool: claims the slot            -> Booked
--   live_decline(...)                     agent tool                             -> Declined
--   live_escalate(...)                    agent tool: question for clinic staff
--   live_post_call(...)                   after hang-up: duration and transcript
--   live_call_unanswered(outreach, why)   busy / no answer / failed to connect
--   live_record_sms(...)                  a text Twilio accepted                 -> Text sent (fallback)
--   live_sms_failed(outreach, reason)     the fallback text could not be sent    -> Needs attention
--   reset_demo_patient(patient)           rehearsal helper: makes one patient "never contacted" again
--
-- Creates no tables. Safe to run more than once. Plain ASCII only.
-- Requires 01_workflow_tables.sql and 03_recall_job.sql to have been run first.
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.


-- ------------------------------------------------------------------
-- Phone numbers. Stored phones look like "555-201-0001" or "+15405550123".
-- E.164 is the form carriers use: a plus sign, country code, then digits. US numbers only.
-- ------------------------------------------------------------------

create or replace function public.dosely_e164(p text)
returns text
language sql
immutable
as $$
    select case
               when p is null then null
               when trim(p) like '+%' and length(regexp_replace(p, '\D', '', 'g')) between 8 and 15
                   then '+' || regexp_replace(p, '\D', '', 'g')
               when length(regexp_replace(p, '\D', '', 'g')) = 10
                   then '+1' || regexp_replace(p, '\D', '', 'g')
               when length(regexp_replace(p, '\D', '', 'g')) = 11 and regexp_replace(p, '\D', '', 'g') like '1%'
                   then '+' || regexp_replace(p, '\D', '', 'g')
           end
$$;


-- ------------------------------------------------------------------
-- One helper so every live event insert has the same columns. The clinic, provider, patient
-- and condition come from the outreach row, so callers pass only what happened.
-- ------------------------------------------------------------------

create or replace function public.live_event(
    p_outreach bigint, p_type text, p_meta jsonb default '{}'::jsonb, p_ts timestamptz default now())
returns void
language sql
set search_path = public
as $$
    insert into events (ts, clinic_name, doctor_id, patient_id, outreach_id, condition, type, recall_run_id, simulated, meta)
    select p_ts, o.clinic_name, o.doctor_id, o.patient_id, o.id, p.diagnoses[1], p_type, o.recall_run_id, false, coalesce(p_meta, '{}'::jsonb)
      from outreach o
      join ehr_patients p on p.id = o.patient_id
     where o.id = p_outreach
$$;

-- The first tool request of a call is the first proof that a person picked up.
-- Writes call_answered once and opens the call summary row.
create or replace function public.live_mark_answered(p_outreach bigint)
returns void
language plpgsql
set search_path = public
as $$
begin
    if not exists (select 1 from events e where e.outreach_id = p_outreach and e.type = 'call_answered') then
        perform live_event(p_outreach, 'call_answered');
    end if;
    insert into call_summaries (outreach_id, contact_result, patient_response, call_started_at)
    values (p_outreach, 'answered', 'On the call now', now())
    on conflict (outreach_id) do nothing;
end;
$$;

-- Every agent tool starts here. Returns the outreach row when the ids belong together and the
-- call is a live one. Returns no row otherwise, and the tool answers "unknown call".
-- "booked" and "declined" are included because a patient can still ask a question, or change
-- their mind, after either one and before hanging up.
create or replace function public.live_outreach_row(p_outreach bigint, p_patient bigint)
returns setof public.outreach
language sql
stable
set search_path = public
as $$
    select o.* from outreach o
     where o.id = p_outreach and o.patient_id = p_patient
       and not o.simulated
       and o.status in ('queued', 'calling', 'booked', 'declined')
$$;

create or replace function public.live_is_verified(p_outreach bigint)
returns boolean
language sql
stable
set search_path = public
as $$
    select exists (select 1 from events e where e.outreach_id = p_outreach and e.type = 'identity_verified')
$$;

-- "Tuesday, September 22 at 9:30 AM". The agent reads this text aloud, and the texts use it too.
create or replace function public.dosely_spoken_time(p_ts timestamptz)
returns text
language sql
stable
as $$
    select to_char(p_ts at time zone 'America/New_York', 'FMDay, FMMonth FMDD "at" FMHH12:MI AM')
$$;


-- ------------------------------------------------------------------
-- Patients at the clinic whose stored phone is in the whitelist: in practice the one patient row
-- that carries a team member's own name, date of birth and phone, so the call asks for them.
-- Two uses, both automatic:
--   "Run recall now" passes these ids to run_recall as p_skip_patients, so the simulated batch
--   never contacts them and they are still Queued when someone clicks Call, and
--   the Recall activity list shows them first.
-- ------------------------------------------------------------------

create or replace function public.live_patient_ids(p_phones text[], p_clinic text)
returns bigint[]
language sql
stable
set search_path = public
as $$
    select coalesce(array_agg(p.id order by p.id), '{}'::bigint[])
      from ehr_patients p
      join ehr_doctors d on d.id = p.doctor_id
     where d.clinic_name = p_clinic
       and p_phones is not null
       and dosely_e164(p.phone) in (select dosely_e164(w) from unnest(p_phones) as w)
$$;


-- ------------------------------------------------------------------
-- The Call button on a Queued row.
--
-- Checks the same rules run_recall uses (overdue, consent, not on hold, no do-not-contact flag,
-- nothing open, not contacted in the last 45 days, no upcoming appointment). Then:
--   p_live and call consent -> creates the outreach row (status queued, simulated = false) and
--                              returns what the web route needs to place the call
--   anything else           -> writes nothing and returns live = false. The web route then runs
--                              the simulated contact for this one patient.
-- p_live is true when DEMO_PHONE_WHITELIST has a number in it, which is how real calling is switched on.
--
-- Which number rings is decided by the web route, not here: the patient's stored phone if that
-- phone is itself in the whitelist, otherwise the first whitelisted number. Seeded patients have
-- fictional 555 numbers, so in practice every call rings the team's own phone.
-- "phone" in the result is the stored one, so the route can apply that rule.
--
-- Locking the patient row makes two fast clicks run one after the other; the second is refused.
-- ------------------------------------------------------------------

drop function if exists public.start_live_call(bigint, text[], boolean);

create or replace function public.start_live_call(p_patient bigint, p_live boolean default true)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    c_recontact_days constant integer := 45;   -- keep equal to run_recall
    c_clinic_phone   constant text := '(555) 014-9000';
    v_today date := (now() at time zone 'America/New_York')::date;
    pt      ehr_patients;
    d       ehr_doctors;
    v_out   bigint;
begin
    select * into pt from ehr_patients where id = p_patient for update;
    if not found then return jsonb_build_object('ok', false, 'reason', 'No such patient.'); end if;
    select * into d from ehr_doctors where id = pt.doctor_id;

    if pt.next_followup_due is null or pt.next_followup_due >= v_today then
        return jsonb_build_object('ok', false, 'reason', 'This patient is not overdue.');
    elsif pt.on_hold then
        return jsonb_build_object('ok', false, 'reason', 'This patient is on hold. Release them first.');
    elsif pt.do_not_contact then
        return jsonb_build_object('ok', false, 'reason', 'This patient has a do-not-contact flag.');
    elsif not (coalesce(pt.consent_for_calls, false) or coalesce(pt.consent_for_sms, false)) then
        return jsonb_build_object('ok', false, 'reason', 'No call or text consent on file.');
    elsif exists (select 1 from outreach o where o.patient_id = p_patient
                     and (o.created_at > now() - make_interval(days => c_recontact_days)
                          or o.status in ('queued', 'calling', 'text_sent', 'booked'))) then
        return jsonb_build_object('ok', false, 'reason', 'This patient has already been contacted.');
    elsif exists (select 1 from ehr_appointments ap where ap.patient_id = p_patient
                     and ap.status = 'scheduled' and ap.appointment_date > now()) then
        return jsonb_build_object('ok', false, 'reason', 'This patient already has an upcoming appointment.');
    end if;

    if not coalesce(p_live, false) or not coalesce(pt.consent_for_calls, false) then
        return jsonb_build_object('ok', true, 'live', false);
    end if;

    insert into outreach (patient_id, doctor_id, clinic_name, channel, status, simulated)
    values (pt.id, pt.doctor_id, d.clinic_name, 'voice', 'queued', false)
    returning id into v_out;
    perform live_event(v_out, 'outreach_queued');

    return jsonb_build_object('ok', true, 'live', true, 'call', jsonb_build_object(
        'outreach_id', v_out, 'patient_id', pt.id, 'first_name', pt.first_name, 'phone', dosely_e164(pt.phone),
        'clinic_name', d.clinic_name, 'clinic_phone', c_clinic_phone,
        'doctor_name', case when d.last_name = 'Gomez' then 'NP ' else 'Dr. ' end || d.last_name));
end;
$$;


-- ------------------------------------------------------------------
-- Result of asking ElevenLabs to place the call
-- ------------------------------------------------------------------

create or replace function public.live_call_placed(p_outreach bigint, p_call_sid text, p_conversation_id text)
returns void
language plpgsql
set search_path = public
as $$
begin
    update outreach set status = 'calling', call_sid = p_call_sid, updated_at = now()
     where id = p_outreach and not simulated and status = 'queued';
    if not found then return; end if;
    perform live_event(p_outreach, 'call_placed', jsonb_build_object('conversation_id', p_conversation_id));
end;
$$;

create or replace function public.live_call_failed(p_outreach bigint, p_reason text)
returns void
language plpgsql
set search_path = public
as $$
declare
    v_patient bigint;
begin
    update outreach set status = 'needs_attention', updated_at = now()
     where id = p_outreach and not simulated and status in ('queued', 'calling')
    returning patient_id into v_patient;
    if not found then return; end if;

    perform live_event(p_outreach, 'call_failed', jsonb_build_object('final', true, 'reason', left(coalesce(p_reason, ''), 300)));
    insert into call_summaries (outreach_id, contact_result, patient_response, call_started_at)
    values (p_outreach, 'failed', 'Not reached', now())
    on conflict (outreach_id) do update set contact_result = 'failed', patient_response = 'Not reached';
    insert into action_items (patient_id, outreach_id, text)
    values (v_patient, p_outreach, 'Call could not be placed.');
end;
$$;

-- Webhooks identify a call by what they carry: our outreach id (after a conversation), or only the
-- carrier call id and the ElevenLabs conversation id (when the call never connected).
create or replace function public.live_find_outreach(p_outreach bigint, p_call_sid text, p_conversation_id text)
returns bigint
language sql
stable
set search_path = public
as $$
    select coalesce(
        (select o.id from outreach o where o.id = p_outreach and not o.simulated),
        (select o.id from outreach o where p_call_sid is not null and o.call_sid = p_call_sid and not o.simulated),
        (select e.outreach_id from events e
          where p_conversation_id is not null and e.type = 'call_placed' and not e.simulated
            and e.meta->>'conversation_id' = p_conversation_id
          order by e.id desc limit 1))
$$;


-- ------------------------------------------------------------------
-- Agent tools. Each returns JSON that the voice agent reads. None of them returns anything
-- clinical: no diagnosis, medication or drug ever leaves through these.
-- ------------------------------------------------------------------

create or replace function public.live_verify_patient(p_outreach bigint, p_patient bigint, p_dob date)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    o outreach;
begin
    select * into o from live_outreach_row(p_outreach, p_patient);
    if not found then return jsonb_build_object('verified', false, 'error', 'unknown call'); end if;
    perform live_mark_answered(p_outreach);

    if not exists (select 1 from ehr_patients p where p.id = p_patient and p.date_of_birth = p_dob) then
        return jsonb_build_object('verified', false, 'message', 'The date of birth does not match our records.');
    end if;

    if not live_is_verified(p_outreach) then
        perform live_event(p_outreach, 'identity_verified');
        update call_summaries set identity_verified = true where outreach_id = p_outreach;
    end if;
    return jsonb_build_object('verified', true);
end;
$$;

-- Three open times with the patient's own provider, on the next three days that have any,
-- aimed at a morning, an early-afternoon and a late-afternoon time so the choices differ.
-- Starts 18 hours out, the same lead time the recall job uses.
create or replace function public.live_available_slots(p_outreach bigint, p_patient bigint)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    o       outreach;
    v_slots jsonb;
begin
    select * into o from live_outreach_row(p_outreach, p_patient);
    if not found then return jsonb_build_object('slots', '[]'::jsonb, 'error', 'unknown call'); end if;
    perform live_mark_answered(p_outreach);
    if not live_is_verified(p_outreach) then
        return jsonb_build_object('slots', '[]'::jsonb, 'error', 'identity not verified yet. Call verify_patient first.');
    end if;

    with open_slots as (
        select s.id, s.starts_at, (s.starts_at at time zone 'America/New_York') as local_ts
          from ehr_slots s
         where s.doctor_id = o.doctor_id and s.booked_by_patient_id is null
           and s.starts_at > now() + interval '18 hours'
           and s.starts_at < now() + interval '21 days'
    ),
    days as (
        select x.day, row_number() over (order by x.day) as n
          from (select distinct local_ts::date as day from open_slots) x
         order by x.day limit 3
    ),
    picked as (
        -- Per day: the first slot at or after that day's target time, else the day's earliest slot.
        select distinct on (d.day) s.id, s.starts_at
          from days d
          join open_slots s on s.local_ts::date = d.day
         order by d.day, (s.local_ts::time < (array[time '09:00', time '13:00', time '15:00'])[d.n::int]), s.local_ts
    )
    select coalesce(jsonb_agg(jsonb_build_object('slot_id', pk.id::text, 'when', dosely_spoken_time(pk.starts_at)) order by pk.starts_at), '[]'::jsonb)
      into v_slots from picked pk;

    return jsonb_build_object(
        'slots', v_slots,
        'provider', (select case when d.last_name = 'Gomez' then 'NP ' else 'Dr. ' end || d.last_name from ehr_doctors d where d.id = o.doctor_id));
end;
$$;

-- Claims the slot and writes the appointment in one transaction. The slot update only succeeds while
-- booked_by_patient_id is still null, so the agent and staff can never both take the same time.
-- Asking twice for the same call returns the booking that already exists.
-- "confirmation" in the result is for the web route, which sends that text and removes it before
-- answering the agent. It is absent when the patient has no text consent. Its "to" is the stored
-- phone; the route applies the whitelist rule from the top of this file before sending.
create or replace function public.live_book(p_outreach bigint, p_patient bigint, p_slot bigint)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    c_clinic_phone constant text := '(555) 014-9000';
    o        outreach;
    pt       ehr_patients;
    v_start  timestamptz;
    v_appt   bigint;
    v_result jsonb;
begin
    select * into o from live_outreach_row(p_outreach, p_patient);
    if not found then return jsonb_build_object('booked', false, 'error', 'unknown call'); end if;
    perform live_mark_answered(p_outreach);
    if not live_is_verified(p_outreach) then
        return jsonb_build_object('booked', false, 'error', 'identity not verified yet. Call verify_patient first.');
    end if;

    select a.id, a.appointment_date into v_appt, v_start
      from ehr_appointments a where a.outreach_id = p_outreach and a.status = 'scheduled' limit 1;
    if v_appt is not null then
        return jsonb_build_object('booked', true, 'appointment_id', v_appt, 'when', dosely_spoken_time(v_start));
    end if;

    update ehr_slots set booked_by_patient_id = p_patient
     where id = p_slot and booked_by_patient_id is null and doctor_id = o.doctor_id and starts_at > now()
    returning starts_at into v_start;
    if not found then
        return jsonb_build_object('booked', false, 'reason', 'That time was just taken. Call get_available_appointments again and offer new times.');
    end if;

    insert into ehr_appointments (patient_id, doctor_id, slot_id, outreach_id, appointment_date, status, source, review_state)
    values (p_patient, o.doctor_id, p_slot, p_outreach, v_start, 'scheduled', 'dosely', 'new')
    returning id into v_appt;

    update call_summaries set appointment_id = v_appt, patient_response = 'Booked on the call.' where outreach_id = p_outreach;
    update outreach set status = 'booked', updated_at = now() where id = p_outreach;
    perform live_event(p_outreach, 'appointment_booked',
                       jsonb_build_object('via', 'call', 'starts_at', v_start, 'appointment_id', v_appt));

    v_result := jsonb_build_object('booked', true, 'appointment_id', v_appt, 'when', dosely_spoken_time(v_start));

    select * into pt from ehr_patients where id = p_patient;
    if coalesce(pt.consent_for_sms, false) and dosely_e164(pt.phone) is not null then
        v_result := v_result || jsonb_build_object('confirmation', jsonb_build_object(
            'to', dosely_e164(pt.phone),
            'body', format('Your appointment with %s is confirmed for %s. Reply C to cancel or call %s to reschedule.',
                           o.clinic_name, to_char(v_start at time zone 'America/New_York', 'Dy, Mon FMDD "at" FMHH12:MI AM'), c_clinic_phone)));
    end if;
    return v_result;
end;
$$;

create or replace function public.live_decline(p_outreach bigint, p_patient bigint)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    o outreach;
begin
    select * into o from live_outreach_row(p_outreach, p_patient);
    if not found then return jsonb_build_object('recorded', false, 'error', 'unknown call'); end if;
    perform live_mark_answered(p_outreach);
    if o.status = 'booked' then
        return jsonb_build_object('recorded', false, 'error', 'an appointment is already booked on this call');
    end if;
    if o.status = 'declined' then
        return jsonb_build_object('recorded', true);
    end if;

    update outreach set status = 'declined', updated_at = now() where id = p_outreach;
    update call_summaries set patient_response = 'Declined to schedule for now.' where outreach_id = p_outreach;
    perform live_event(p_outreach, 'declined');
    return jsonb_build_object('recorded', true);
end;
$$;

-- A question for clinic staff. Does not change the outreach status: a question on a booked call
-- leaves it booked. The text lands in the patient card's "Action needed" list.
create or replace function public.live_escalate(p_outreach bigint, p_patient bigint, p_question text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    o outreach;
    v_question text := left(trim(coalesce(p_question, '')), 500);
begin
    select * into o from live_outreach_row(p_outreach, p_patient);
    if not found then return jsonb_build_object('recorded', false, 'error', 'unknown call'); end if;
    perform live_mark_answered(p_outreach);
    if v_question = '' then return jsonb_build_object('recorded', false, 'error', 'question is empty'); end if;

    perform live_event(p_outreach, 'escalated', jsonb_build_object('source', 'call'));
    insert into action_items (patient_id, outreach_id, text)
    values (p_patient, p_outreach, format('Asked on the call: "%s"', v_question));
    update call_summaries set patient_question = v_question, followup_required = true where outreach_id = p_outreach;
    return jsonb_build_object('recorded', true);
end;
$$;


-- ------------------------------------------------------------------
-- The call did not reach a person: busy, no answer, or it failed to connect.
-- For busy and no answer the result carries the fallback text for the web route to send
-- ("fallback"), or the patient goes to Needs attention when there is no text consent.
-- Does nothing the second time, so a repeated webhook is harmless.
-- ------------------------------------------------------------------

create or replace function public.live_call_unanswered(p_outreach bigint, p_reason text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    c_clinic_phone constant text := '(555) 014-9000';
    o  outreach;
    pt ehr_patients;
begin
    select * into o from outreach where id = p_outreach and not simulated and status in ('queued', 'calling') for update;
    if not found then return jsonb_build_object('handled', false); end if;
    if exists (select 1 from events e where e.outreach_id = p_outreach and e.type in ('call_no_answer', 'call_busy')) then
        return jsonb_build_object('handled', false);
    end if;
    select * into pt from ehr_patients where id = o.patient_id;

    if p_reason not in ('busy', 'no-answer') then
        perform live_call_failed(p_outreach, coalesce(p_reason, 'unknown'));
        return jsonb_build_object('handled', true, 'outcome', 'failed');
    end if;

    perform live_event(p_outreach, case when p_reason = 'busy' then 'call_busy' else 'call_no_answer' end);
    insert into call_summaries (outreach_id, contact_result, patient_response, call_started_at)
    values (p_outreach, case when p_reason = 'busy' then 'busy' else 'no_answer' end, 'No response yet', o.updated_at)
    on conflict (outreach_id) do nothing;

    if coalesce(pt.consent_for_sms, false) and dosely_e164(pt.phone) is not null then
        return jsonb_build_object('handled', true, 'outcome', 'fallback', 'fallback', jsonb_build_object(
            'to', dosely_e164(pt.phone),
            'body', format('Hi %s, this is %s. We''re reaching out about scheduling your next appointment. Reply YES for help booking, or call %s.',
                           pt.first_name, o.clinic_name, c_clinic_phone)));
    end if;

    update outreach set status = 'needs_attention', updated_at = now() where id = p_outreach;
    perform live_event(p_outreach, 'escalated', jsonb_build_object('final', true, 'reason', 'no_text_consent'));
    insert into action_items (patient_id, outreach_id, text) values (o.patient_id, p_outreach, 'No answer. No text consent on file.');
    return jsonb_build_object('handled', true, 'outcome', 'needs_attention');
end;
$$;


-- ------------------------------------------------------------------
-- After hang-up. p_transcript is already in the shape the patient card renders
-- (web/lib/types.ts TranscriptItem[]), built by the webhook route.
--
-- If no agent tool was ever requested, nobody engaged with the agent: the call rang out into
-- voicemail or the person hung up at once. That is handled as "no answer", including the fallback text.
-- ------------------------------------------------------------------

create or replace function public.live_post_call(
    p_outreach bigint, p_started_at timestamptz, p_duration integer, p_transcript jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    o outreach;
begin
    select * into o from outreach where id = p_outreach and not simulated for update;
    if not found then return jsonb_build_object('handled', false); end if;

    if not exists (select 1 from events e where e.outreach_id = p_outreach and e.type = 'call_answered') then
        return live_call_unanswered(p_outreach, 'no-answer');
    end if;

    update call_summaries
       set duration_seconds = greatest(coalesce(p_duration, 0), 0),
           call_started_at  = coalesce(p_started_at, call_started_at),
           raw_transcript   = coalesce(p_transcript, '[]'::jsonb),
           patient_response = case when patient_question is not null and appointment_id is not null then 'Booked. Asked a question for clinic staff.'
                                   when patient_response = 'On the call now' then 'Call ended before a time was booked.'
                                   else patient_response end
     where outreach_id = p_outreach;

    -- Answered, but the call ended with neither a booking nor a decline. Staff take it from here.
    if o.status = 'calling' then
        update outreach set status = 'needs_attention', updated_at = now() where id = p_outreach;
        perform live_event(p_outreach, 'escalated', jsonb_build_object('final', true, 'reason', 'ended_without_booking'));
        insert into action_items (patient_id, outreach_id, text)
        values (o.patient_id, p_outreach,
                case when live_is_verified(p_outreach) then 'Call ended before a time was booked.'
                     else 'Identity was not verified on the call.' end);
        return jsonb_build_object('handled', true, 'outcome', 'needs_attention');
    end if;
    return jsonb_build_object('handled', true, 'outcome', o.status);
end;
$$;


-- ------------------------------------------------------------------
-- Texts. The web route sends through Twilio first and records only what Twilio accepted,
-- so a row here always means a real message. message_sid makes a repeat a no-op.
-- ------------------------------------------------------------------

create or replace function public.live_record_sms(
    p_outreach bigint, p_kind text, p_body text, p_message_sid text, p_status text)
returns void
language plpgsql
set search_path = public
as $$
declare
    o outreach;
begin
    select * into o from outreach where id = p_outreach and not simulated;
    if not found then return; end if;

    insert into sms_messages (outreach_id, patient_id, direction, kind, body, message_sid, status, simulated)
    values (p_outreach, o.patient_id, 'out', p_kind, p_body, p_message_sid, coalesce(p_status, 'sent'), false)
    on conflict (message_sid) where message_sid is not null do nothing;
    if not found then return; end if;

    if p_kind = 'confirmation' then
        perform live_event(p_outreach, 'confirmation_sent');
    else
        perform live_event(p_outreach, 'sms_sent', jsonb_build_object('kind', p_kind));
        if p_kind = 'fallback' then
            update outreach set status = 'text_sent', channel = 'sms', updated_at = now() where id = p_outreach and status in ('queued', 'calling');
        end if;
    end if;
end;
$$;

create or replace function public.live_sms_failed(p_outreach bigint, p_reason text)
returns void
language plpgsql
set search_path = public
as $$
declare
    v_patient bigint;
begin
    update outreach set status = 'needs_attention', updated_at = now()
     where id = p_outreach and not simulated and status in ('queued', 'calling')
    returning patient_id into v_patient;
    if not found then return; end if;
    perform live_event(p_outreach, 'escalated', jsonb_build_object('final', true, 'reason', 'fallback_text_failed', 'detail', left(coalesce(p_reason, ''), 300)));
    insert into action_items (patient_id, outreach_id, text) values (v_patient, p_outreach, 'No answer. The follow-up text could not be sent.');
end;
$$;


-- ------------------------------------------------------------------
-- Rehearsal helper. Removes everything the agent wrote about ONE patient, frees their booked slot,
-- and restores their due date if a completed visit had moved it. Afterwards the patient shows as
-- Queued again and the next "Run recall now" can call them.
--   select public.reset_demo_patient(251);
-- ------------------------------------------------------------------

create or replace function public.reset_demo_patient(p_patient bigint)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_due      date;
    v_outreach integer;
begin
    -- The original due date was recorded in the patient's first "found" event (same rule as 07_reset.sql).
    select (e.meta->>'due')::date into v_due
      from events e
     where e.patient_id = p_patient and e.type = 'patient_flagged' and e.meta ? 'due'
       and exists (select 1 from ehr_appointments a where a.patient_id = p_patient and a.source = 'dosely' and a.status = 'completed')
     order by e.ts asc limit 1;
    if v_due is not null then
        update ehr_patients p
           set next_followup_due = v_due,
               last_appointment  = (v_due - make_interval(months => coalesce(p.recommended_followup_months, 6)))::date
         where p.id = p_patient;
    end if;

    update ehr_slots s set booked_by_patient_id = null
      from ehr_appointments a
     where a.slot_id = s.id and a.patient_id = p_patient and a.source = 'dosely';

    delete from call_summaries where outreach_id in (select id from outreach where patient_id = p_patient);
    delete from sms_messages   where patient_id = p_patient;
    delete from action_items   where patient_id = p_patient;
    delete from ehr_appointments where patient_id = p_patient and source = 'dosely';
    delete from outreach where patient_id = p_patient;
    get diagnostics v_outreach = row_count;
    delete from events where patient_id = p_patient and type <> 'panel_shown';
    update ehr_patients set on_hold = false where id = p_patient;

    return jsonb_build_object('patient_id', p_patient, 'outreach_removed', v_outreach, 'due_date_restored', v_due is not null);
end;
$$;


-- ------------------------------------------------------------------
-- Only the secret key (service_role) may call these.
-- ------------------------------------------------------------------

revoke execute on function public.live_event(bigint, text, jsonb, timestamptz)              from public, anon, authenticated;
revoke execute on function public.live_mark_answered(bigint)                                from public, anon, authenticated;
revoke execute on function public.live_outreach_row(bigint, bigint)                         from public, anon, authenticated;
revoke execute on function public.live_is_verified(bigint)                                  from public, anon, authenticated;
revoke execute on function public.live_patient_ids(text[], text)                            from public, anon, authenticated;
revoke execute on function public.start_live_call(bigint, boolean)                          from public, anon, authenticated;
revoke execute on function public.live_call_placed(bigint, text, text)                      from public, anon, authenticated;
revoke execute on function public.live_call_failed(bigint, text)                            from public, anon, authenticated;
revoke execute on function public.live_find_outreach(bigint, text, text)                    from public, anon, authenticated;
revoke execute on function public.live_verify_patient(bigint, bigint, date)                 from public, anon, authenticated;
revoke execute on function public.live_available_slots(bigint, bigint)                      from public, anon, authenticated;
revoke execute on function public.live_book(bigint, bigint, bigint)                         from public, anon, authenticated;
revoke execute on function public.live_decline(bigint, bigint)                              from public, anon, authenticated;
revoke execute on function public.live_escalate(bigint, bigint, text)                       from public, anon, authenticated;
revoke execute on function public.live_call_unanswered(bigint, text)                        from public, anon, authenticated;
revoke execute on function public.live_post_call(bigint, timestamptz, integer, jsonb)       from public, anon, authenticated;
revoke execute on function public.live_record_sms(bigint, text, text, text, text)           from public, anon, authenticated;
revoke execute on function public.live_sms_failed(bigint, text)                             from public, anon, authenticated;
revoke execute on function public.reset_demo_patient(bigint)                                from public, anon, authenticated;
grant  execute on function public.live_patient_ids(text[], text)                            to service_role;
grant  execute on function public.start_live_call(bigint, boolean)                          to service_role;
grant  execute on function public.live_call_placed(bigint, text, text)                      to service_role;
grant  execute on function public.live_call_failed(bigint, text)                            to service_role;
grant  execute on function public.live_find_outreach(bigint, text, text)                    to service_role;
grant  execute on function public.live_verify_patient(bigint, bigint, date)                 to service_role;
grant  execute on function public.live_available_slots(bigint, bigint)                      to service_role;
grant  execute on function public.live_book(bigint, bigint, bigint)                         to service_role;
grant  execute on function public.live_decline(bigint, bigint)                              to service_role;
grant  execute on function public.live_escalate(bigint, bigint, text)                       to service_role;
grant  execute on function public.live_call_unanswered(bigint, text)                        to service_role;
grant  execute on function public.live_post_call(bigint, timestamptz, integer, jsonb)       to service_role;
grant  execute on function public.live_record_sms(bigint, text, text, text, text)           to service_role;
grant  execute on function public.live_sms_failed(bigint, text)                             to service_role;
grant  execute on function public.reset_demo_patient(bigint)                                to service_role;
