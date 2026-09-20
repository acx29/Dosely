// GET /api/patients/overdue
// Recall activity list: every patient at the clinic who is overdue right now, with live status.

import { CLINIC } from "@/lib/server/db";
import { respond } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";

export async function GET() {
  return respond("recall_activity", { p_clinic: CLINIC });
}
