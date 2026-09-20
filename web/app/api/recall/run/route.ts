// POST /api/recall/run
// "Run recall now". Calls the same database function the 30-minute schedule calls.
// A manual run spreads its calls over 3 minutes instead of 30, so the result is visible quickly.

import { respond } from "@/lib/server/rpc";

const MANUAL_WINDOW_MINUTES = 3;

export async function POST() {
  return respond("run_recall", { p_trigger: "manual", p_window_minutes: MANUAL_WINDOW_MINUTES });
}
