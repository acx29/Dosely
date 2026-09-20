// POST /api/agent-tools/decline_followup   { patient_id, outreach_id }
// The patient does not want to schedule now. The outreach ends as Declined.

import { dbResult, toolRoute } from "@/lib/server/agent-tool";

export const POST = toolRoute("decline_followup", ({ outreach, patient }) =>
  dbResult("live_decline", { p_outreach: outreach, p_patient: patient }),
);
