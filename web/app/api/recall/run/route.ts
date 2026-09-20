// POST /api/recall/run
// "Run recall now". This button is the only thing that runs the recall job: no schedule is installed.
// (db/sql/05_schedule.sql can install a 30-minute schedule that does these same three steps.)
//
// A manual run spreads its calls over 3 minutes instead of 30, so the result is visible quickly.

import { RECALL_BATCH_SIZE } from "@/lib/config";
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
  return respond("run_recall", { p_trigger: "manual", p_window_minutes: MANUAL_WINDOW_MINUTES, p_demo_batch: RECALL_BATCH_SIZE });
}
