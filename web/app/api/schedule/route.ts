// GET /api/schedule
// One working week for every provider at the clinic: the practice's own appointments,
// plus the bookings the agent made, each with alternative times and providers free at the same time.

import { CLINIC } from "@/lib/server/db";
import { respond } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";

export async function GET() {
  return respond("schedule_week", { p_clinic: CLINIC });
}
