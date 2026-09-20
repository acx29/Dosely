// POST /api/recall/run
// "Run recall now". Runs the recall job on demand. The same three steps also run every 30 minutes
// inside the database, from the pg_cron job that db/sql/05_schedule.sql installs.
//
// A manual run spreads its calls over 3 minutes instead of 30, so the result is visible quickly.
//
// Every contact in a run is simulated inside the database. No phone rings. A real call is placed
// only by the Call button on a Queued row (app/api/patients/[id]/call/route.ts).

import { RECALL_BATCH_SIZE } from "@/lib/config";
import { whitelistedPatientIds } from "@/lib/server/live";
import { callDb, respond } from "@/lib/server/rpc";

const MANUAL_WINDOW_MINUTES = 3;
const SLOT_HORIZON_DAYS = 28;

export async function POST() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD in the clinic's time zone

  // 1. Keep 28 days of appointment slots open. Adds only the days that are missing.
  // 2. Record today's physician app opens, which feed the Impiricus "Weekly physician opens" tile.
  //    Does nothing after the first call of the day.
  // Neither is essential to the run itself, so a failure here is logged and the run still happens.
  const prep = await Promise.all([
    callDb("ensure_slots", { p_from: today, p_days: SLOT_HORIZON_DAYS }),
    callDb("simulate_opens", { p_day: today }),
  ]);
  for (const step of prep) if (step.error) console.error("recall run preparation step failed:", step.error);

  // 3. The run. The batch size is shared with the Recall screen, which shows "next run contacts N".
  //    A patient whose stored phone is in DEMO_PHONE_WHITELIST is passed over, so the simulated batch
  //    never contacts them and they are still Queued when someone clicks Call on their row.
  //    The setting is sent only when there is such a patient, so a database that does not have the
  //    p_skip_patients setting yet keeps working without it.
  const skip = await whitelistedPatientIds();
  return respond("run_recall", {
    p_trigger: "manual",
    p_window_minutes: MANUAL_WINDOW_MINUTES,
    p_demo_batch: RECALL_BATCH_SIZE,
    ...(skip.length > 0 ? { p_skip_patients: skip } : {}),
  });
}
