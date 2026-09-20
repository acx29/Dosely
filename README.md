# Dosely

**Agentic therapy starts for provider networks.**

Dosely finds patients who are overdue for follow-up in a practice's own records, contacts them by phone and text without staff involvement, and books them directly into the practice calendar. Staff review the bookings, not the phone calls. When a returning patient's chart is close to a partner drug's record, the physician sees clearly labeled sponsored information. The physician makes every clinical decision.

Built at VTHacks 14 (September 18–20, 2026) for the Impiricus track, *"Build the Next HCP Engagement Tool."* Dosely is designed as a feature inside DocUpdate, the Impiricus physician app.

Team: Mike Dornic and Joel Kishore.

> All data is synthetic. Every patient, clinic, pharmaceutical company and sponsored drug in this repository is invented. The sponsored drugs are modeled on real drug classes so that indications are medically sensible.

## What it does, step by step

1. **Detect.** A SQL query over the practice's records finds patients whose follow-up date has passed, who have no upcoming appointment, and who have consented to calls or texts.
2. **Contact.** A recall job runs every 30 minutes inside the database and on demand from the **Run recall now** button. It never depends on whether a drug matched the patient. A voice agent calls the patient. If nobody answers, a text message goes out. If the call fails, the patient is flagged for staff.
3. **Book.** On the call, the agent confirms the patient's date of birth, offers three open times, and books one. The booking is final the moment it is made, and the slot is claimed in the same database transaction so two bookings can never take the same time.
4. **Review.** New bookings appear on the Schedule tagged "Booked by Dosely". Staff can leave a booking alone, mark it **Looks good**, **Reschedule** it, or **Reassign** it to another provider. **Hold** on any patient removes them from the next run.
5. **Summarize.** The call transcript, text messages, and any question the patient asked are saved on the patient's card. Questions go to a "Needs attention" list for clinic staff.
6. **Show sponsored information.** The patient card ends with a separate, dashed-border section titled "Sponsored pharmaceutical matches · Impiricus partners". It lists the partner drug records nearest to the patient's chart, with the similarity score and an **Explain more** button that asks Gemini to describe the overlap. The section's footer reads "Not a treatment recommendation. For physician review only."
7. **Report.** The practice dashboard shows overdue patients found, contacted, booked, seen, and visit revenue recovered. The Impiricus dashboard shows aggregate counts only: panels shown, physicians reached, and label views by therapeutic area and campaign.

## Run the screens in two minutes

No accounts or keys are needed. With no environment variables set, every screen reads the example data in `web/fixtures/`.

```sh
git clone https://github.com/acx29/Dosely.git   # download the repository
cd Dosely/web                                   # the Next.js app lives in web/
npm install                                     # install the packages listed in web/package.json
npm run dev                                     # start the development server on http://localhost:3000
```

| URL | What you see |
|---|---|
| `http://localhost:3000/` | Landing page. Sign-in is a demo stub: every sign-in button opens the dashboard. |
| `/doctor/performance` | Practice performance: headline numbers, recall funnel chart, needs-attention list |
| `/doctor/schedule` | Week calendar per provider, agent bookings highlighted, review cards |
| `/doctor/recall` | Recall activity: every overdue patient with status, Hold / Release, Run recall now |
| `/doctor/patients/[id]` | Patient card: clinical context, transcript, texts, timeline, sponsored section |
| `/impiricus` | What the sponsor sees. Aggregates only. Not linked from the practice screens. |

## How it is built

```
Supabase Postgres  (pgvector + pg_cron)
   │   tables, the recall job, and one SQL function per screen
   ▼
web/   Next.js app
   ├── screens:          /   /doctor/*   /impiricus
   └── route handlers:   web/app/api/*   (server-side, call the SQL functions)
          ├──► ElevenLabs voice agent ──► Twilio number ──► patient phone
          │        └── five tool webhooks back into web/app/api/agent-tools/*
          ├──► Twilio REST API (fallback text message)
          └──► Gemini API ("Explain more" text)

Rag/ and db/matcher/   Python scripts, run by hand
   └── embed drug records, search by vector similarity, save matches to the database
```

**Database.** Supabase Postgres holds the practice records, the partner drug records, and the workflow tables. The recall job is a set of SQL functions in [db/sql/03_recall_job.sql](db/sql/03_recall_job.sql). `pg_cron` runs it every 30 minutes inside the database, so it keeps running when no laptop is on. Every state change writes a row to one `events` table, and every number on both dashboards is a count over that table, so the practice view and the Impiricus view always agree.

**Web app.** Next.js (App Router), TypeScript and Tailwind. The route handlers under [web/app/api/](web/app/api/) run on the server and call the SQL functions with the Supabase secret key. [web/lib/server/db.ts](web/lib/server/db.ts) imports `server-only`, so the build fails if browser code ever imports the key. [web/lib/api.ts](web/lib/api.ts) is the only file that decides whether the screens read fixtures or the live API.

**Matching (version 1).** For one patient, the matcher does this:

1. Maps each diagnosis name to therapeutic areas using a fixed table in [Rag/rag_agent.py](Rag/rag_agent.py).
2. Builds a text from the patient's diagnoses, current medications and visit note. The text contains no name, date of birth, phone number or email.
3. Embeds that text with `Supabase/gte-small` (384 dimensions). The model runs locally through `sentence-transformers`, so no patient text is sent to an embedding API.
4. Calls the SQL function `match_pharma_drugs`, which keeps only drugs from companies flagged as Impiricus partners and in the routed therapeutic areas, then orders them by cosine distance to the patient text (pgvector).
5. Saves the five nearest drugs to the `matches` table with rank, similarity score and the embedding model name ([db/matcher/write_matches.py](db/matcher/write_matches.py)).

Gemini is used only to write the "why this record surfaced" text. It receives the same de-identified patient text plus the drug record, runs once per click of **Explain more**, and the result is saved so it is never generated twice.

**Voice and text.** Real calls go through the ElevenLabs Agents API, which dials out over a Twilio number. During the call the agent uses five tools, each an HTTPS request to this app: `verify_patient`, `get_available_appointments`, `book_appointment`, `decline_followup`, `escalate_to_staff`. After the call, ElevenLabs sends the transcript to a post-call webhook. Fallback texts go through the Twilio REST API. Simulated contacts and real contacts write the same tables and the same event types, so every screen shows them the same way. Simulated rows carry `simulated = true`.

## Rules the code enforces

- **Dialing.** Real calls and texts go only to numbers listed in `DEMO_PHONE_WHITELIST`. [web/lib/server/live.ts](web/lib/server/live.ts) checks the final number against that list immediately before every call and every text. With an empty list, no carrier is contacted and the contact is simulated in the database.
- **What the voice agent knows.** Clinic name, doctor name, patient name, date of birth and first documented diagnosis, which it needs to verify identity and state the reason for the visit. Its prompt forbids saying the date of birth or the diagnosis before verification passes. No medication, drug or sponsor data is ever sent to it.
- **Tool requests.** Every agent tool request must carry a shared secret header, compared in constant time. The post-call webhook verifies the ElevenLabs HMAC signature and rejects requests older than 30 minutes.
- **Sponsored section.** Always the last section on the card, in its own bordered container, labeled as sponsored, with the "Not a treatment recommendation" footer. Whether a patient is recalled never depends on it.
- **Sponsor dashboard.** `/impiricus` responses are counts by therapeutic area, drug and company. They contain no patient identifiers, names or rows.
- **Practice dashboard.** Shows the practice's own visit revenue only. No drug or manufacturer figures.

## Full setup with your own Supabase project

The SQL files in this repository create the workflow tables and all functions. They do **not** create the four base tables (`ehr_doctors`, `ehr_patients`, `pharma_companies`, `pharma_drugs`). Those were created directly in the team's Supabase project and must exist before step 3.

SQL files are run by hand: in the Supabase dashboard, open **SQL Editor**, paste the whole file, and click **Run**. Every file is safe to run more than once.

1. Create a Supabase project. Copy the project URL and the secret key.
2. Create `.env` in the repository root (used by the Python scripts) and `web/.env.local` (used by the web app). Variable names are in the table below. Both files are ignored by git.
3. Run the two schema files:
   - [Rag/sql/01_vector_setup.sql](Rag/sql/01_vector_setup.sql): enables pgvector, adds the embedding column, adds `match_pharma_drugs`
   - [db/sql/01_workflow_tables.sql](db/sql/01_workflow_tables.sql): slots, appointments, outreach, call summaries, texts, matches, events
4. Seed the synthetic practices and patients. This adds the demo practice's providers, which step 5 needs.

```sh
cd Dosely                                    # repository root
python3 -m venv .venv                        # create an isolated Python environment in .venv/
source .venv/bin/activate                    # use that environment in this terminal
pip install -r Rag/requirements.txt          # supabase client, sentence-transformers, python-dotenv, google-genai

python db/seed/seed_patients.py --dry-run    # --dry-run generates and summarizes patients, writes nothing
python db/seed/seed_patients.py              # insert the synthetic patients; only appends, never changes existing rows
```

5. Run the function files in this order:
   - [db/sql/02_metrics_functions.sql](db/sql/02_metrics_functions.sql): the numbers on Practice performance
   - [db/sql/03_recall_job.sql](db/sql/03_recall_job.sql): the recall job
   - [db/sql/04_start.sql](db/sql/04_start.sql): opens 28 days of appointment slots for every provider and fills part of the demo practice's calendar
   - [db/sql/06_screen_functions.sql](db/sql/06_screen_functions.sql), [db/sql/08_panels.sql](db/sql/08_panels.sql), [db/sql/10_live_calls.sql](db/sql/10_live_calls.sql): one function per screen, the sponsored section, real calls
6. Embed the drug records and save each patient's matches:

```sh
python Rag/embed_drugs.py                    # embed every drug record once and store the vector
python db/matcher/write_matches.py           # save the 5 nearest drugs for every overdue patient, no Gemini calls
python db/matcher/write_matches.py --explain --patients 253 255   # --explain also saves Gemini text; --patients limits it to these ids
```

7. Run [db/sql/05_schedule.sql](db/sql/05_schedule.sql) to start the 30-minute schedule. Run it last, because the job begins contacting patients (simulated) as soon as it exists.
8. Start the web app against the database:

```sh
cd web
npm install      # install packages
npm run dev      # with NEXT_PUBLIC_API_URL set, the screens call web/app/api/* instead of reading fixtures
```

Two optional files: [db/sql/09_test_batch.sql](db/sql/09_test_batch.sql) contacts only the 12 hand-written demo patients, and [db/sql/07_reset.sql](db/sql/07_reset.sql) returns the database to "the agent has never run" while keeping every patient, doctor, drug and open slot.

## Real phone calls (optional)

Without this section, the **Call** button and the recall job simulate every contact inside the database.

1. Get a Twilio phone number and an ElevenLabs API key. Add the Twilio and ElevenLabs variables from the table below.
2. Expose the local app on a public HTTPS address (for example with ngrok or a Cloudflare tunnel) and set `PUBLIC_BASE_URL` to that address. ElevenLabs sends tool requests and the post-call webhook to it.
3. Put your own phone number in `DEMO_PHONE_WHITELIST`.
4. Create the agent, its five tools, the phone number import and the webhook:

```sh
cd web
node scripts/setup-elevenlabs.mjs   # creates everything through the ElevenLabs API and saves the ids to web/.elevenlabs.json (ignored by git)
```

Run the script again whenever `PUBLIC_BASE_URL` changes, because the tools and the webhook store that address. Then open `/doctor/recall` and click **Call** on a Queued patient. Seeded patients have fictional 555 numbers, so the phone that rings is the first number in your whitelist.

## Environment variables

| Variable | File | Purpose |
|---|---|---|
| `SUPABASE_URL` | both | Supabase project URL |
| `SUPABASE_SECRET_KEY` | both | Supabase secret key. Read by server-side code only. |
| `GEMINI_API_KEY` | both | Gemini API key for the "Explain more" text |
| `NEXT_PUBLIC_API_URL` | `web/.env.local` | `http://localhost:3000/api` to use the database. Leave unset to read fixtures. |
| `CLINIC_NAME` | `web/.env.local` | Practice shown on the dashboard. Default `Joel's Clinic`. |
| `VISIT_RATE_USD` | `web/.env.local` | Revenue per visit. Default `150`. |
| `LLM_MODEL` | `web/.env.local` | Gemini model name. Optional. |
| `DEMO_PHONE_WHITELIST` | `web/.env.local` | Comma-separated numbers that may be called or texted. Empty turns real calling off. |
| `ELEVENLABS_API_KEY` | `web/.env.local` | ElevenLabs API key |
| `AGENT_TOOL_SECRET` | `web/.env.local` | Any long random string. Sent by the agent's tools, checked by the app. |
| `PUBLIC_BASE_URL` | `web/.env.local` | Public HTTPS address of the running app |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | `.env` | Twilio account and the number calls and texts come from |

## Repository layout

```
/
├── web/                  Next.js app
│   ├── app/              landing page, /doctor screens, /impiricus, and api/ route handlers
│   ├── components/       screen components
│   ├── lib/              api.ts (fixtures or live), types.ts, server/ (database, calls, Gemini)
│   ├── fixtures/         example JSON in the exact shapes the screens expect
│   └── scripts/          one-time ElevenLabs setup
├── db/
│   ├── sql/              workflow tables, recall job, screen functions, schedule, reset
│   ├── seed/             synthetic patient generator
│   └── matcher/          saves matcher output to the matches table
└── Rag/                  drug embeddings, vector search, Gemini explanation
```

## What comes next

Impiricus reviewed the concept during the event and asked for drug matching that is deterministic and auditable. Version 1 proves the full recall flow. Version 2 is planned as follows and is not built yet:

- **Rules decide, vectors only order.** A drug is eligible only if coded chart data passes SQL checks against the drug's indication codes, required context (current medications by RxNorm code, lab thresholds) and exclusion codes. A contraindication on file removes the drug. Vector similarity only orders the drugs that passed.
- **Every result can be replayed.** Each match logs the rule ids that fired, a hash of the patient text, the embedding model, the scores and the threshold. The "why" list on the card is generated from those rules, and Gemini leaves the drug path.
- **Real scheduling systems.** Production would read and write the EHR's scheduling API (FHIR `Slot` and `Appointment`) instead of the demo calendar tables.

## Stack

Supabase (Postgres, pgvector, pg_cron) · Next.js 16, React 19, TypeScript, Tailwind 4 · three.js (landing page) · Python, sentence-transformers · Gemini API · ElevenLabs Agents · Twilio
