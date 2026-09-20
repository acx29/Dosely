// GET /api/activity/summary
// Sidebar: what the agent is doing this minute, new-booking count, and the last few events.

import { CLINIC } from "@/lib/server/db";
import { respond } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";

export async function GET() {
  return respond("activity_summary", { p_clinic: CLINIC });
}
