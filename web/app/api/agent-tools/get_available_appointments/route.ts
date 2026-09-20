// POST /api/agent-tools/get_available_appointments   { patient_id, outreach_id }
// Three open times with the patient's own provider. Each has a slot_id the agent passes to
// book_appointment and a "when" text ("Tuesday, September 22 at 9:30 AM") it reads aloud.

import { dbResult, toolRoute } from "@/lib/server/agent-tool";

export const POST = toolRoute("get_available_appointments", ({ outreach, patient }) =>
  dbResult("live_available_slots", { p_outreach: outreach, p_patient: patient }),
);
