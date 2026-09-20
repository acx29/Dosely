// POST /api/agent-tools/book_appointment   { patient_id, outreach_id, slot_id }
// Claims the slot and writes the appointment in one database transaction (live_book), then sends
// the confirmation text. The booking is firm as soon as live_book returns; a text that fails to
// send does not undo it.
//
// The agent is told whether the text went out (text_confirmation), so it only promises one that was sent.

import { dbResult, toolRoute, toWholeNumber } from "@/lib/server/agent-tool";
import { sendSms } from "@/lib/server/live";
import { callDb } from "@/lib/server/rpc";

export const POST = toolRoute("book_appointment", async ({ outreach, patient, body }) => {
  const slot = toWholeNumber(body.slot_id);
  if (slot === null) {
    return { booked: false, reason: "slot_id must be one of the slot_id values returned by get_available_appointments." };
  }

  const { confirmation, ...result } = await dbResult("live_book", { p_outreach: outreach, p_patient: patient, p_slot: slot });
  if (result.booked !== true) return result;

  // Absent when the patient has no text consent, and on a repeated request for a booking that already exists.
  const text = confirmation as { to?: string; body?: string } | undefined;
  if (!text?.body) return { ...result, text_confirmation: false };

  const sent = await sendSms(outreach, text.to ?? null, text.body);
  if (sent.ok) {
    await callDb("live_record_sms", { p_outreach: outreach, p_kind: "confirmation", p_body: text.body, p_message_sid: sent.sid, p_status: sent.status });
  }
  return { ...result, text_confirmation: sent.ok };
});
