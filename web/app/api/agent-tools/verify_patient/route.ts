// POST /api/agent-tools/verify_patient   { patient_id, outreach_id, date_of_birth: "YYYY-MM-DD" }
// Called by the voice agent after the patient says their date of birth. Compares it with the chart.
// Nothing else on the call works until this has returned { verified: true } once.

import { dbResult, toolRoute } from "@/lib/server/agent-tool";

function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text; // rejects 1968-02-30
}

export const POST = toolRoute("verify_patient", async ({ outreach, patient, body }) => {
  const dob = typeof body.date_of_birth === "string" ? body.date_of_birth.trim() : "";
  if (!isRealDate(dob)) {
    return { verified: false, message: "date_of_birth must be a real date written as YYYY-MM-DD. Ask again and resend." };
  }
  return dbResult("live_verify_patient", { p_outreach: outreach, p_patient: patient, p_dob: dob });
});
