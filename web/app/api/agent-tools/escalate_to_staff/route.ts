// POST /api/agent-tools/escalate_to_staff   { patient_id, outreach_id, question }
// Anything the agent must not answer itself (every medical question) goes to clinic staff.
// The question appears under "Action needed" on the patient card. The booking status is not changed.

import { dbResult, toolRoute } from "@/lib/server/agent-tool";

export const POST = toolRoute("escalate_to_staff", async ({ outreach, patient, body }) => {
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return { recorded: false, error: "question is required: the patient's question in their own words." };
  return dbResult("live_escalate", { p_outreach: outreach, p_patient: patient, p_question: question });
});
