// POST /api/webhooks/elevenlabs/post-call
// ElevenLabs sends a request here after every call attempt. Two kinds matter:
//
//   post_call_transcription   the call connected and has ended. Carries the transcript and the duration.
//                             Stored on the call summary; the patient card renders it as "Agent transcript".
//   call_initiation_failure   the call never connected: busy, no-answer, or unknown.
//                             Busy and no-answer send the fallback text. Unknown goes to Needs attention.
//
// A connected call in which the agent never requested a tool (voicemail picked up, or the person
// hung up at once) is treated as "no answer" by the database function, and also gets the fallback text.
//
// Every request must carry a valid elevenlabs-signature header (see lib/server/elevenlabs-webhook.ts).
// The database functions ignore a repeat of something already recorded, so ElevenLabs may safely resend.

import { NextResponse } from "next/server";
import { toWholeNumber } from "@/lib/server/agent-tool";
import { toTranscriptItems, validSignature, type ElevenLabsTurn } from "@/lib/server/elevenlabs-webhook";
import { sendSms, webhookSecret } from "@/lib/server/live";
import { callDb } from "@/lib/server/rpc";

interface PostCallEvent {
  type?: string;
  data?: {
    conversation_id?: string;
    failure_reason?: string;
    transcript?: ElevenLabsTurn[];
    metadata?: { start_time_unix_secs?: number; call_duration_secs?: number; body?: { CallSid?: string } };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  };
}

type Outcome = { handled?: boolean; outcome?: string; fallback?: { to?: string; body?: string } };

/** Sends the fallback text a database function asked for, then records that it went out, or that it could not. */
async function sendFallback(outreach: number, result: Outcome) {
  if (!result.fallback?.body) return;
  const sent = await sendSms(outreach, result.fallback.to ?? null, result.fallback.body);
  if (sent.ok) {
    await callDb("live_record_sms", { p_outreach: outreach, p_kind: "fallback", p_body: result.fallback.body, p_message_sid: sent.sid, p_status: sent.status });
  } else {
    await callDb("live_sms_failed", { p_outreach: outreach, p_reason: sent.error });
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = webhookSecret();
  if (!secret) {
    console.error("[post-call] refused: ELEVENLABS_WEBHOOK_SECRET is not set in web/.env.local");
    return NextResponse.json({ error: "webhook secret is not configured" }, { status: 503 });
  }
  if (!validSignature(raw, req.headers.get("elevenlabs-signature"), secret)) {
    console.error("[post-call] refused: bad or missing elevenlabs-signature header");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: PostCallEvent;
  try {
    event = JSON.parse(raw) as PostCallEvent;
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }
  const data = event.data ?? {};
  if (event.type !== "post_call_transcription" && event.type !== "call_initiation_failure") {
    return NextResponse.json({ ignored: event.type ?? "unknown type" });
  }

  // Which outreach is this? A finished conversation carries the outreach_id we sent as a dynamic
  // variable. A call that never connected carries only the carrier's call id and the conversation id.
  const variables = data.conversation_initiation_client_data?.dynamic_variables ?? {};
  const callSid = data.metadata?.body?.CallSid ?? (typeof variables.system__call_sid === "string" ? variables.system__call_sid : null);
  const found = await callDb("live_find_outreach", {
    p_outreach: toWholeNumber(variables.outreach_id),
    p_call_sid: callSid,
    p_conversation_id: data.conversation_id ?? null,
  });
  if (found.error) return NextResponse.json({ error: found.error }, { status: 500 });
  const outreach = typeof found.data === "number" ? found.data : null;
  if (outreach === null) {
    // A call this app did not place, for example a test call made from the ElevenLabs dashboard.
    console.log(`[post-call] ${event.type} for conversation ${data.conversation_id}: no matching outreach, ignored`);
    return NextResponse.json({ ignored: "no matching outreach" });
  }

  const result =
    event.type === "call_initiation_failure"
      ? await callDb("live_call_unanswered", { p_outreach: outreach, p_reason: data.failure_reason ?? "unknown" })
      : await callDb("live_post_call", {
          p_outreach: outreach,
          p_started_at: data.metadata?.start_time_unix_secs ? new Date(data.metadata.start_time_unix_secs * 1000).toISOString() : null,
          p_duration: Math.round(data.metadata?.call_duration_secs ?? 0),
          p_transcript: toTranscriptItems(data.transcript),
        });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

  const outcome = (result.data ?? {}) as Outcome;
  console.log(`[post-call] outreach_id=${outreach} ${event.type} -> ${outcome.outcome ?? "already recorded"}`);
  await sendFallback(outreach, outcome);
  return NextResponse.json({ ok: true });
}
