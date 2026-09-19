# Dosely web

Next.js (App Router) + TypeScript + Tailwind v4.

| Route | Screen |
|---|---|
| `/doctor` | Redirects to Practice performance (first item in the sidebar) |
| `/doctor/performance` | Funnel, recovered visit revenue, needs attention |
| `/doctor/schedule` | Week calendar with agent bookings, plus a "Review cards" view of new bookings |
| `/doctor/recall` | Recall activity monitor: Run recall now, Hold / Release, live statuses |
| `/doctor/patients/[id]` | Patient card: context, transcript, texts, timeline, sponsored panel |
| `/impiricus` | Sponsor-side aggregates. Not linked from the doctor nav on purpose |

## Run

```
npm install
npm run dev
```

Open http://localhost:3000. With no env set, every page reads `fixtures/*.json`.

## How recall works in the UI

Recall is automatic. Nobody approves individual patients. The agent calls and texts overdue patients, books into open slots, and the booking is firm the moment it is made. Staff then see it on the Schedule and can:

- **Looks good**: clears the "new" badge. Changes nothing for the patient.
- **Reschedule**: moves it to another open slot and texts the patient the new time.
- **Reassign**: same time, different provider. Texts the patient who they will see.

The brake is **Hold** on the Recall activity screen, which takes a patient out of the next run. **Run recall now** is the demo trigger; in production the same job runs on a schedule.

## Connect the API

Create `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

`lib/api.ts` is the only file that knows where data comes from. It expects:

```
GET  /patients/overdue                 → OverdueRow[]
GET  /patients/:id                     → PatientCard
GET  /schedule                         → ScheduleData (providers, existing events, agent bookings)
GET  /metrics/doctor                   → DoctorMetrics
GET  /metrics/impiricus                → ImpiricusMetrics
GET  /activity/summary                 → SidebarData (agent status, new-booking count, last few events)
POST /recall/run
POST /patients/:id/hold                { held: boolean }
POST /appointments/:id/keep
POST /appointments/:id/reschedule      { slot_id }
POST /appointments/:id/reassign        { provider_id }
```

Shapes are in `lib/types.ts` and mirrored by the fixtures. The API needs CORS enabled for the web origin. Every action updates the UI optimistically, so the screens work against fixtures with no backend.

## Rules that are easy to break

- `SponsoredPanel` renders only when `sponsored_panel` is non-null, and is always the last section on the card. No score, no dose, no "match" or "recommended" wording.
- `/doctor/performance` shows the practice's own visit revenue only. No drug or manufacturer names.
- `/impiricus` is aggregates only. No patient fields, and no prescriptions or starts column.
- Colors come from the tokens in `app/globals.css` (`bg-page`, `text-ink`, `border-line`, `text-green-dk`, ...). Don't hand-type hex.

Demo patients: John Smith (booked Tue 9:30, sponsored panel), Maria Lopez (no answer → text → YES, no panel), Robert Chen (queued, contraindication on file, no panel), George Whitman (on hold).
