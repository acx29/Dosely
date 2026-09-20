-- Dosely screen functions
--
-- One read function per screen, each returning JSON in exactly the shape the web app expects
-- (web/lib/types.ts), plus the functions behind the buttons. Reads only show what has already
-- happened: events with ts <= now(), bookings with created_at <= now().
--
--   recall_activity(clinic)            Recall activity list        -> OverdueRow[]
--   activity_summary(clinic)           sidebar agent block + feed  -> SidebarData
--   schedule_week(clinic)              Schedule and review cards   -> ScheduleData
--   impiricus_overview(days)           Impiricus top-line totals (aggregates only)
--   set_patient_hold(patient, held)    Hold / Release
--   keep_booking(appointment)          Looks good
--   reschedule_booking(appointment, slot)     atomic slot swap, texts the patient
--   reassign_booking(appointment, provider)   same time, other provider, texts the patient
--   simulate_opens(day)                physician app-open events, for the Impiricus page
--
-- Creates no tables. Safe to run more than once.
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.


-- ------------------------------------------------------------------
-- Recall activity: every patient at the clinic who is overdue right now and may be contacted
-- ------------------------------------------------------------------

create or replace function public.recall_activity(p_clinic text)
returns jsonb
language sql
stable
set search_path = public
as $$
    select coalesce(jsonb_agg(to_jsonb(x) - 'due' order by x.due, x.id), '[]'::jsonb)
      from (
        select p.id::text as id,
               p.first_name || ' ' || p.last_name as name,
               extract(year from age(current_date, p.date_of_birth))::int as age,
               to_jsonb(coalesce(p.diagnoses, '{}')) as conditions,
               p.last_appointment::text as last_visit,
               greatest(0, (extract(year from age(current_date, p.next_followup_due)) * 12
                          + extract(month from age(current_date, p.next_followup_due)))::int) as months_overdue,
               case
                   when p.on_hold then 'on_hold'
                   when o.status_now = 'calling' then 'calling'
                   when o.status_now = 'text_sent' then 'text_sent'
                   when o.status_now = 'booked' and ap.appointment_date is not null then 'booked'
                   when o.status_now in ('needs_attention', 'declined', 'no_show') then 'needs_attention'
                   else 'queued'
               end as status,
               exists (select 1 from matches m where m.patient_id = p.id) as has_sponsored_panel,
               case when o.status_now = 'booked' then to_char(ap.appointment_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end as booked_for,
               p.recommended_followup_months as interval_months,
               case when p.consent_for_calls and p.consent_for_sms then 'Calls and texts'
                    when p.consent_for_calls then 'Calls only' else 'Texts only' end as consent,
               p.next_followup_due as due
          from ehr_patients p
          join ehr_doctors d on d.id = p.doctor_id
          left join lateral (
              select n.status_now from outreach_now n where n.patient_id = p.id order by n.created_at desc, n.id desc limit 1
          ) o on true
          left join lateral (
              select a.appointment_date from ehr_appointments a
               where a.patient_id = p.id and a.source = 'dosely' and a.status = 'scheduled' and a.created_at <= now()
               order by a.appointment_date limit 1
          ) ap on true
         where d.clinic_name = p_clinic
           and p.next_followup_due < current_date
           and (coalesce(p.consent_for_calls, false) or coalesce(p.consent_for_sms, false))
           and not p.do_not_contact
      ) x;
$$;


-- ------------------------------------------------------------------
-- Sidebar: what the agent is doing this minute, and the last few things that happened
-- ------------------------------------------------------------------

create or replace function public.activity_summary(p_clinic text)
returns jsonb
language sql
stable
set search_path = public
as $$
    with current_status as (
        select n.id, n.status_now, n.last_event_at from outreach_now n where n.clinic_name = p_clinic
    ),
    feed as (
        select e.ts,
               case
                   when e.type = 'appointment_booked' then
                       p.first_name || ' ' || p.last_name || ' booked ' ||
                       to_char((e.meta->>'starts_at')::timestamptz at time zone 'America/New_York', 'Dy FMHH12:MI AM')
                   when e.type = 'sms_reply' then p.first_name || ' ' || p.last_name || ' replied YES'
                   -- chr(183) is the middle dot. Written as a code so the file stays plain ASCII
                   -- and no clipboard or editor can change its encoding.
                   when e.type = 'call_placed' then p.first_name || ' ' || p.last_name || ' ' || chr(183) || ' call in progress'
                   when e.type = 'call_failed' then p.first_name || ' ' || p.last_name || ' ' || chr(183) || ' call failed twice'
                   when e.type = 'sms_sent' then p.first_name || ' ' || p.last_name || ' ' || chr(183) || ' no answer, text sent'
                   when e.type = 'declined' then p.first_name || ' ' || p.last_name || ' declined for now'
               end as text,
               case when e.type = 'appointment_booked' then 'booking'
                    when e.type in ('sms_reply', 'sms_sent') then 'sms'
                    when e.type = 'call_placed' then 'call'
                    else 'problem' end as kind
          from events e
          join ehr_patients p on p.id = e.patient_id
         where e.clinic_name = p_clinic
           and e.ts <= now() and e.ts > now() - interval '3 days'
           and (   e.type in ('appointment_booked', 'declined')
                or (e.type = 'sms_reply'  and e.meta->>'intent' = 'yes')
                or (e.type = 'sms_sent'   and e.meta->>'kind' = 'fallback')
                or (e.type = 'call_failed' and e.meta->>'final' = 'true')
                   -- a placed call only shows while that call is still the latest thing that happened
                or (e.type = 'call_placed' and exists (select 1 from current_status c
                                                        where c.id = e.outreach_id and c.status_now = 'calling' and c.last_event_at <= e.ts + interval '40 seconds')))
         order by e.ts desc
         limit 6
    )
    select jsonb_build_object(
        'new_bookings', (select count(*) from ehr_appointments a join ehr_doctors d on d.id = a.doctor_id
                          where d.clinic_name = p_clinic and a.source = 'dosely' and a.status = 'scheduled'
                            and a.review_state = 'new' and a.created_at <= now()),
        'agent', jsonb_build_object(
            'active', true,
            'calls_in_progress',    (select count(*) from current_status where status_now = 'calling'),
            'texts_awaiting_reply', (select count(*) from current_status where status_now = 'text_sent' and last_event_at > now() - interval '48 hours'),
            'booked_today',         (select count(*) from events e where e.clinic_name = p_clinic and e.type = 'appointment_booked' and e.ts <= now()
                                        and (e.ts at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date)),
        'activity', coalesce((select jsonb_agg(jsonb_build_object(
                                  'at', to_char(f.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'text', f.text, 'kind', f.kind) order by f.ts desc)
                                from feed f), '[]'::jsonb));
$$;


-- ------------------------------------------------------------------
-- Schedule: one working week for every provider at the clinic
-- ------------------------------------------------------------------

create or replace function public.schedule_week(p_clinic text)
returns jsonb
language sql
stable
set search_path = public
as $$
    with wk as (
        -- Monday of this week on weekdays, Monday of next week on Saturday and Sunday.
        select case when extract(isodow from today) >= 6 then today + (8 - extract(isodow from today))::int
                    else today - (extract(isodow from today)::int - 1) end as monday
          from (select (now() at time zone 'America/New_York')::date as today) t
    ),
    span as (
        select monday, (monday + time '00:00') at time zone 'America/New_York' as starts,
                       (monday + 5 + time '00:00') at time zone 'America/New_York' as ends from wk
    ),
    docs as (
        select d.id, d.last_name,
               case when d.last_name = 'Gomez' then 'np' else 'physician' end as role
          from ehr_doctors d where d.clinic_name = p_clinic
    ),
    bookings as (
        select a.id, a.patient_id, a.doctor_id, a.appointment_date, a.review_state, a.outreach_id, p.first_name, p.last_name,
               p.date_of_birth, p.diagnoses, p.last_appointment, p.recommended_followup_months
          from ehr_appointments a
          join docs dc on dc.id = a.doctor_id
          join ehr_patients p on p.id = a.patient_id
          cross join span s
         where a.source = 'dosely' and a.status = 'scheduled' and a.created_at <= now()
           and a.appointment_date >= s.starts and a.appointment_date < s.ends
    )
    select jsonb_build_object(
        'week_start', (select monday::text from wk),
        'providers', (select jsonb_agg(jsonb_build_object(
                                'id', dc.id::text,
                                'name', case when dc.role = 'np' then 'NP ' else 'Dr. ' end || dc.last_name,
                                'role', dc.role) order by dc.id) from docs dc),
        'events', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', 'ev' || a.id, 'provider_id', a.doctor_id::text,
                       'start', to_char(a.appointment_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'end',   to_char((a.appointment_date + interval '30 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'label', a.appointment_type) order by a.appointment_date)
              from ehr_appointments a join docs dc on dc.id = a.doctor_id cross join span s
             where a.source = 'practice' and a.status = 'scheduled'
               and a.appointment_date >= s.starts and a.appointment_date < s.ends), '[]'::jsonb),
        'bookings', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', b.id::text,
                       'patient_id', b.patient_id::text,
                       'patient_name', b.first_name || ' ' || b.last_name,
                       'age', extract(year from age(current_date, b.date_of_birth))::int,
                       'conditions', to_jsonb(coalesce(b.diagnoses, '{}')),
                       'start', to_char(b.appointment_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'end',   to_char((b.appointment_date + interval '30 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'provider_id', b.doctor_id::text,
                       -- How overdue the patient was when the agent reached them: their due date is still the old one until the visit happens.
                       'months_overdue', greatest(0, (extract(year from age(current_date, (b.last_appointment + make_interval(months => coalesce(b.recommended_followup_months, 6)))::date)) * 12
                                                    + extract(month from age(current_date, (b.last_appointment + make_interval(months => coalesce(b.recommended_followup_months, 6)))::date)))::int),
                       'via', coalesce((select case when cs.contact_result = 'answered'
                                                    then 'Call ' || chr(183) || ' ' || (cs.duration_seconds / 60) || 'm ' || (cs.duration_seconds % 60) || 's'
                                                    else 'Text' end
                                          from call_summaries cs where cs.outreach_id = b.outreach_id), 'Text'),
                       'note', coalesce((select cs.patient_response from call_summaries cs where cs.outreach_id = b.outreach_id), 'Booked by text.'),
                       'review_state', b.review_state,
                       'alt_slots', coalesce((
                           select jsonb_agg(jsonb_build_object(
                                      'slot_id', s2.id::text,
                                      'start', to_char(s2.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                      'end',   to_char(s2.ends_at   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by s2.starts_at)
                             from (select s1.id, s1.starts_at, s1.ends_at from ehr_slots s1
                                    where s1.doctor_id = b.doctor_id and s1.booked_by_patient_id is null and s1.starts_at > now() + interval '12 hours'
                                      and (s1.starts_at at time zone 'America/New_York')::date <> (b.appointment_date at time zone 'America/New_York')::date
                                    order by abs(extract(epoch from (s1.starts_at - b.appointment_date))), s1.starts_at limit 3) s2), '[]'::jsonb),
                       'reassign_options', coalesce((
                           select jsonb_agg(s3.doctor_id::text order by s3.doctor_id)
                             from ehr_slots s3 join docs dc2 on dc2.id = s3.doctor_id
                            where s3.starts_at = b.appointment_date and s3.booked_by_patient_id is null and s3.doctor_id <> b.doctor_id), '[]'::jsonb)
                   ) order by (b.review_state = 'new') desc, b.appointment_date)
              from bookings b), '[]'::jsonb));
$$;


-- ------------------------------------------------------------------
-- Patient card -> PatientCard. Returns null when the patient does not exist.
-- The timeline, texts and call summary come from the patient's most recent outreach.
-- sponsored_panel stays null until the matcher writes rows to the matches table.
-- ------------------------------------------------------------------

create or replace function public.patient_card(p_patient bigint)
returns jsonb
language sql
stable
set search_path = public
as $$
    with p as (
        select pt.*, d.last_name as doctor_last, d.clinic_name,
               case when d.last_name = 'Gomez' then 'NP ' else 'Dr. ' end || d.last_name as doctor_name
          from ehr_patients pt join ehr_doctors d on d.id = pt.doctor_id
         where pt.id = p_patient
    ),
    o as (
        select n.id, n.status_now from outreach_now n where n.patient_id = p_patient order by n.created_at desc, n.id desc limit 1
    ),
    ap as (
        select a.appointment_date, case when d.last_name = 'Gomez' then 'NP ' else 'Dr. ' end || d.last_name as with_name
          from ehr_appointments a join ehr_doctors d on d.id = a.doctor_id
         where a.patient_id = p_patient and a.source = 'dosely' and a.status = 'scheduled' and a.created_at <= now()
         order by a.appointment_date limit 1
    ),
    tl as (
        select e.ts,
               case e.type
                   when 'outreach_queued'         then 'Queued by the scheduling agent'
                   when 'call_placed'             then 'Call placed'
                   when 'call_answered'           then 'Call answered'
                   when 'identity_verified'       then 'Identity verified by date of birth'
                   when 'call_no_answer'          then 'No answer'
                   when 'call_busy'               then 'Line busy'
                   when 'call_failed'             then 'Call failed'
                   when 'sms_sent'                then case when e.meta->>'kind' = 'slot_options' then 'Available times sent by text' else 'Fallback text sent' end
                   when 'sms_reply'               then case when e.meta->>'intent' = 'yes' then 'Patient replied YES' else 'Patient picked a time by text' end
                   when 'appointment_booked'      then 'Appointment booked'
                   when 'confirmation_sent'       then 'Confirmation text sent'
                   when 'booking_kept'            then 'Booking reviewed by staff'
                   when 'appointment_rescheduled' then 'Rescheduled by staff'
                   when 'appointment_reassigned'  then 'Reassigned to ' || coalesce(e.meta->>'provider', 'another provider')
                   when 'declined'                then 'Declined to schedule for now'
                   when 'escalated'               then case when e.meta->>'final' = 'true' then 'Flagged for clinic staff' else 'Question passed to clinic staff' end
                   when 'visit_completed'         then 'Visit completed'
                   when 'visit_no_show'           then 'Missed the visit'
               end as label,
               case when e.type = 'outreach_queued' then 'approval'
                    when e.type in ('call_placed', 'call_answered', 'identity_verified') then 'call'
                    when e.type in ('sms_sent', 'sms_reply') then 'sms'
                    when e.type in ('appointment_booked', 'confirmation_sent', 'booking_kept', 'appointment_rescheduled', 'appointment_reassigned', 'visit_completed') then 'booking'
                    else 'problem' end as kind
          from events e, o
         where e.outreach_id = o.id and e.ts <= now()
    )
    select jsonb_strip_nulls(jsonb_build_object(
        'id', p.id::text,
        'name', p.first_name || ' ' || p.last_name,
        'age', extract(year from age(current_date, p.date_of_birth))::int,
        'status', case
                      when p.on_hold then 'on_hold'
                      when (select status_now from o) = 'calling' then 'calling'
                      when (select status_now from o) = 'text_sent' then 'text_sent'
                      when (select status_now from o) = 'booked' and exists (select 1 from ap) then 'booked'
                      when (select status_now from o) in ('needs_attention', 'declined', 'no_show') then 'needs_attention'
                      else 'queued' end,
        'follow_up', jsonb_build_object(
            'last_visit', p.last_appointment::text,
            'interval_months', coalesce(p.recommended_followup_months, 6),
            'due', p.next_followup_due::text,
            'months_overdue', greatest(0, (extract(year from age(current_date, p.next_followup_due)) * 12
                                         + extract(month from age(current_date, p.next_followup_due)))::int)),
        'clinical', jsonb_build_object(
            'conditions', coalesce((select jsonb_agg(jsonb_build_object('name', c)) from unnest(p.diagnoses) c), '[]'::jsonb),
            'medications', to_jsonb(coalesce(p.current_prescriptions, '{}')),
            -- The stored note ends with a follow-up sentence written on seed day. Drop it: the card computes overdue itself.
            'note', nullif(trim(regexp_replace(coalesce(p.relevant_notes, ''), '\s*Follow-up (is currently|remains scheduled)[^.]*\.\s*$', '')), '')),
        'appointment', (select jsonb_build_object(
                                   'at', to_char(ap.appointment_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                   'with', ap.with_name || ' ' || chr(183) || ' ' || p.clinic_name) from ap),
        'call_summary', (select jsonb_build_object(
                                   'channel', case when exists (select 1 from sms_messages m where m.outreach_id = cs.outreach_id and m.kind = 'fallback' and m.at <= now())
                                                   then 'Voice agent, then text' else 'Voice agent' end,
                                   'identity_verified', case when cs.identity_verified then 'Yes, date of birth' when cs.contact_result = 'answered' then 'No' else 'Not reached' end,
                                   'patient_response', coalesce(cs.patient_response, 'No response yet'),
                                   'duration', case cs.contact_result when 'answered' then (cs.duration_seconds / 60) || 'm ' || (cs.duration_seconds % 60) || 's'
                                                                      when 'busy' then 'Line busy' when 'failed' then 'Call failed' else 'No answer' end)
                           from call_summaries cs, o
                          where cs.outreach_id = o.id and cs.call_started_at <= now())
    )) || jsonb_build_object(
        'action_needed', coalesce((select jsonb_agg(a.text order by a.created_at)
                                     from action_items a where a.patient_id = p_patient and a.resolved_at is null and a.created_at <= now()), '[]'::jsonb),
        'timeline', coalesce((select jsonb_agg(jsonb_build_object('at', to_char(tl.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'label', tl.label, 'kind', tl.kind) order by tl.ts)
                                from tl where tl.label is not null), '[]'::jsonb),
        'sms_thread', coalesce((select jsonb_agg(jsonb_build_object('direction', m.direction, 'at', to_char(m.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'text', m.body) order by m.at, m.id)
                                  from sms_messages m, o where m.outreach_id = o.id and m.at <= now()), '[]'::jsonb),
        'sponsored_panel', null)
      from p;
$$;


-- ------------------------------------------------------------------
-- Impiricus top-line totals. Counts only: no patient, physician or practice identifiers leave this function.
-- ------------------------------------------------------------------

create or replace function public.impiricus_overview(p_days integer default 30)
returns jsonb
language sql
stable
set search_path = public
as $$
    select jsonb_build_object(
        'practices_active',       (select count(distinct clinic_name) from events where ts <= now() and ts > now() - make_interval(days => p_days)),
        'weekly_physician_opens', (select count(*) from events where type = 'digest_opened' and ts <= now() and ts > now() - interval '7 days'),
        'patients_recalled',      (select count(distinct patient_id) from events where type in ('call_placed', 'sms_sent') and ts <= now() and ts > now() - make_interval(days => p_days)),
        'visits_booked',          (select count(*) from events where type = 'appointment_booked' and ts <= now() and ts > now() - make_interval(days => p_days)));
$$;

-- Physician app opens. About 60% of physicians open the app on a working day. One row each.
create or replace function public.simulate_opens(p_day date)
returns integer
language plpgsql
set search_path = public
as $$
declare
    v_added integer;
begin
    if extract(isodow from p_day) >= 6 then return 0; end if;
    if exists (select 1 from events where type = 'digest_opened' and simulated
                  and (ts at time zone 'America/New_York')::date = p_day) then return 0; end if;
    insert into events (ts, clinic_name, doctor_id, type, simulated)
    select (p_day + time '07:30' + make_interval(mins => floor(dosely_u('open-at:' || d.id || p_day) * 540)::int)) at time zone 'America/New_York',
           d.clinic_name, d.id, 'digest_opened', true
      from ehr_doctors d
     where dosely_u('open:' || d.id || p_day) < 0.60;
    get diagnostics v_added = row_count;
    return v_added;
end;
$$;

-- Nothing is filled in here. The scheduled job (05_schedule.sql) calls simulate_opens for the
-- current day on each tick, so opens start at 0 and accumulate from the first scheduled run.


-- ------------------------------------------------------------------
-- Buttons
-- ------------------------------------------------------------------

create or replace function public.set_patient_hold(p_patient bigint, p_held boolean)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_clinic text; v_doctor bigint; v_condition text;
begin
    update ehr_patients set on_hold = p_held where id = p_patient
    returning doctor_id, diagnoses[1] into v_doctor, v_condition;
    if not found then raise exception 'no patient %', p_patient; end if;
    select clinic_name into v_clinic from ehr_doctors where id = v_doctor;
    insert into events (ts, clinic_name, doctor_id, patient_id, condition, type, simulated)
    values (now(), v_clinic, v_doctor, p_patient, v_condition, case when p_held then 'patient_held' else 'patient_released' end, false);
    return jsonb_build_object('patient_id', p_patient, 'on_hold', p_held);
end;
$$;

create or replace function public.keep_booking(p_appointment bigint)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    a record;
begin
    update ehr_appointments set review_state = 'kept', updated_at = now() where id = p_appointment
    returning patient_id, doctor_id, outreach_id into a;
    if not found then raise exception 'no appointment %', p_appointment; end if;
    insert into events (ts, clinic_name, doctor_id, patient_id, outreach_id, type, simulated)
    select now(), d.clinic_name, a.doctor_id, a.patient_id, a.outreach_id, 'booking_kept', false from ehr_doctors d where d.id = a.doctor_id;
    return jsonb_build_object('appointment_id', p_appointment, 'review_state', 'kept');
end;
$$;

-- Claims the new slot first. If someone else took it, nothing changes and an error is raised.
create or replace function public.reschedule_booking(p_appointment bigint, p_slot bigint)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    a record; s record; v_clinic text;
begin
    select * into a from ehr_appointments where id = p_appointment and status = 'scheduled' for update;
    if not found then raise exception 'no scheduled appointment %', p_appointment; end if;

    update ehr_slots set booked_by_patient_id = a.patient_id
     where id = p_slot and booked_by_patient_id is null and doctor_id = a.doctor_id
    returning id, starts_at into s;
    if not found then raise exception 'that time was just taken'; end if;

    if a.slot_id is not null then update ehr_slots set booked_by_patient_id = null where id = a.slot_id; end if;
    update ehr_appointments set slot_id = s.id, appointment_date = s.starts_at, review_state = 'kept', updated_at = now() where id = p_appointment;

    select clinic_name into v_clinic from ehr_doctors where id = a.doctor_id;
    insert into events (ts, clinic_name, doctor_id, patient_id, outreach_id, type, simulated, meta)
    values (now(), v_clinic, a.doctor_id, a.patient_id, a.outreach_id, 'appointment_rescheduled', false, jsonb_build_object('starts_at', s.starts_at));
    insert into sms_messages (outreach_id, patient_id, direction, kind, body, status, simulated, at)
    values (a.outreach_id, a.patient_id, 'out', 'reschedule',
            format('Your appointment with %s has moved to %s. Reply C to cancel or call (555) 014-9000.',
                   v_clinic, to_char(s.starts_at at time zone 'America/New_York', 'Dy, Mon FMDD "at" FMHH12:MI AM')), 'delivered', true, now());
    return jsonb_build_object('appointment_id', p_appointment, 'starts_at', s.starts_at);
end;
$$;

-- Same time, different provider at the same clinic.
create or replace function public.reassign_booking(p_appointment bigint, p_provider bigint)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    a record; s record; v_clinic text; v_name text;
begin
    select * into a from ehr_appointments where id = p_appointment and status = 'scheduled' for update;
    if not found then raise exception 'no scheduled appointment %', p_appointment; end if;
    select clinic_name into v_clinic from ehr_doctors where id = a.doctor_id;
    select case when last_name = 'Gomez' then 'NP ' else 'Dr. ' end || last_name into v_name
      from ehr_doctors where id = p_provider and clinic_name = v_clinic;
    if v_name is null then raise exception 'provider % is not at %', p_provider, v_clinic; end if;

    update ehr_slots set booked_by_patient_id = a.patient_id
     where doctor_id = p_provider and starts_at = a.appointment_date and booked_by_patient_id is null
    returning id, starts_at into s;
    if not found then raise exception '% is not free at that time', v_name; end if;

    if a.slot_id is not null then update ehr_slots set booked_by_patient_id = null where id = a.slot_id; end if;
    update ehr_appointments set slot_id = s.id, doctor_id = p_provider, review_state = 'kept', updated_at = now() where id = p_appointment;

    insert into events (ts, clinic_name, doctor_id, patient_id, outreach_id, type, simulated, meta)
    values (now(), v_clinic, p_provider, a.patient_id, a.outreach_id, 'appointment_reassigned', false, jsonb_build_object('provider', v_name));
    insert into sms_messages (outreach_id, patient_id, direction, kind, body, status, simulated, at)
    values (a.outreach_id, a.patient_id, 'out', 'reassign',
            format('Your appointment on %s is now with %s at %s. Reply C to cancel or call (555) 014-9000.',
                   to_char(a.appointment_date at time zone 'America/New_York', 'Dy, Mon FMDD "at" FMHH12:MI AM'), v_name, v_clinic), 'delivered', true, now());
    return jsonb_build_object('appointment_id', p_appointment, 'provider', v_name);
end;
$$;


-- ------------------------------------------------------------------
-- Only the secret key (service_role) may call these.
-- ------------------------------------------------------------------

revoke execute on function public.patient_card(bigint)               from public, anon, authenticated;
grant  execute on function public.patient_card(bigint)               to service_role;
revoke execute on function public.recall_activity(text)              from public, anon, authenticated;
revoke execute on function public.activity_summary(text)             from public, anon, authenticated;
revoke execute on function public.schedule_week(text)                from public, anon, authenticated;
revoke execute on function public.impiricus_overview(integer)        from public, anon, authenticated;
revoke execute on function public.simulate_opens(date)               from public, anon, authenticated;
revoke execute on function public.set_patient_hold(bigint, boolean)  from public, anon, authenticated;
revoke execute on function public.keep_booking(bigint)               from public, anon, authenticated;
revoke execute on function public.reschedule_booking(bigint, bigint) from public, anon, authenticated;
revoke execute on function public.reassign_booking(bigint, bigint)   from public, anon, authenticated;
grant  execute on function public.recall_activity(text)              to service_role;
grant  execute on function public.activity_summary(text)             to service_role;
grant  execute on function public.schedule_week(text)                to service_role;
grant  execute on function public.impiricus_overview(integer)        to service_role;
grant  execute on function public.simulate_opens(date)               to service_role;
grant  execute on function public.set_patient_hold(bigint, boolean)  to service_role;
grant  execute on function public.keep_booking(bigint)               to service_role;
grant  execute on function public.reschedule_booking(bigint, bigint) to service_role;
grant  execute on function public.reassign_booking(bigint, bigint)   to service_role;
