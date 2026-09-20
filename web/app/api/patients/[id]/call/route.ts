// POST /api/patients/:id/call
// The Call button on a Queued row of the Recall activity screen.
//
//   DEMO_PHONE_WHITELIST has a number -> a real phone call through ElevenLabs. Which phone rings is
//                                        decided by the dialing rule in lib/server/live.ts: only ever a
//                                        whitelisted number, whatever phone the patient has on file.
//   DEMO_PHONE_WHITELIST is empty     -> the simulated contact for this one patient (the same code
//                                        "Run recall now" uses for a batch). No carrier is touched.
//
// The database refuses patients who may not be contacted (on hold, do-not-contact, already
// contacted, not overdue). Those come back as 409 with the reason, and nothing is written.

import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { elevenLabsConfig, masked, placeCall, whitelist, type CallChart, type LiveCall } from "@/lib/server/live";
import { callDb, toId } from "@/lib/server/rpc";

type Started = { ok: false; reason: string } | { ok: true; live: false } | { ok: true; live: true; call: LiveCall };

/** The three chart fields the voice agent's prompt uses. Null when the patient row cannot be read. */
async function chartFor(patientId: number): Promise<CallChart | null> {
  const { data, error } = await db().from("ehr_patients").select("first_name, last_name, date_of_birth, diagnoses").eq("id", patientId).single();
  if (error || !data?.date_of_birth) return null;
  // "1968-03-14" -> "March 14, 1968". Built in UTC so the day never shifts with the server's time zone.
  const spoken = new Date(`${data.date_of_birth}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  return {
    patient_name: `${data.first_name} ${data.last_name}`,
    date_of_birth: spoken,
    diagnosis: (data.diagnoses as string[] | null)?.[0] ?? "a routine follow-up",
  };
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = toId((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "expected a numeric patient id" }, { status: 400 });

  // A whitelist means the team expects a real call. If the ElevenLabs settings are incomplete, say so
  // before anything is written, so a real call is never silently replaced by a simulated one.
  const live = whitelist().length > 0;
  if (live) {
    const config = elevenLabsConfig();
    if ("missing" in config) {
      return NextResponse.json(
        { error: `DEMO_PHONE_WHITELIST is set, so Call places a real call, but web/.env.local is missing: ${config.missing.join(", ")}` },
        { status: 503 },
      );
    }
  }

  const start = await callDb("start_live_call", { p_patient: id, p_live: live });
  if (start.error) return NextResponse.json({ error: start.error }, { status: 500 });
  const started = start.data as Started;
  if (!started.ok) return NextResponse.json({ error: started.reason }, { status: 409 });

  if (!started.live) {
    // One minute instead of thirty, so the simulated call plays out while someone is watching.
    const run = await callDb("run_recall", { p_trigger: "manual", p_window_minutes: 1, p_only_patients: [id] });
    if (run.error) return NextResponse.json({ error: run.error }, { status: 500 });
    return NextResponse.json({ mode: "simulated" });
  }

  const { call } = started;
  const chart = await chartFor(id);
  const placed = chart ? await placeCall(call, chart) : ({ ok: false, error: "the patient's name and date of birth could not be read" } as const);
  if (!placed.ok) {
    await callDb("live_call_failed", { p_outreach: call.outreach_id, p_reason: placed.error });
    return NextResponse.json({ error: `The call could not be placed. ${placed.error}` }, { status: 502 });
  }
  await callDb("live_call_placed", { p_outreach: call.outreach_id, p_call_sid: placed.callSid, p_conversation_id: placed.conversationId });
  return NextResponse.json({ mode: "live", outreach_id: call.outreach_id, ringing: masked(placed.to) });
}
