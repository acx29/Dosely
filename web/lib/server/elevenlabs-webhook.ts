// Two pure helpers for POST /api/webhooks/elevenlabs/post-call. No environment access and no
// network, so they can be run on their own to check them.
//
//   validSignature   proves a webhook request was sent by ElevenLabs
//   toTranscriptItems  turns the ElevenLabs transcript into the rows the patient card renders

import { createHmac, timingSafeEqual } from "node:crypto";
import type { TranscriptItem } from "@/lib/types";

const MAX_AGE_SECONDS = 30 * 60;

/**
 * ElevenLabs signs each webhook with a secret it shows once when the webhook is created.
 * The request carries a header  elevenlabs-signature: t=<unix seconds>,v0=<hex>
 * where <hex> is HMAC-SHA256 of the text "<unix seconds>.<raw request body>" using that secret.
 * A request passes only if the hash matches and the timestamp is less than 30 minutes old.
 */
export function validSignature(rawBody: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = new Map(
    header.split(",").map((part) => {
      const at = part.indexOf("=");
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
    }),
  );
  const timestamp = parts.get("t");
  const sent = parts.get("v0");
  if (!timestamp || !sent || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_AGE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sent, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One turn of data.transcript in a post_call_transcription webhook. Only the fields used here. */
export interface ElevenLabsTurn {
  role?: string; // "agent" or "user"
  message?: string | null;
  time_in_call_secs?: number | null;
  tool_calls?: { request_id?: string; tool_name?: string; params_as_json?: string | null }[] | null;
  tool_results?: { request_id?: string; tool_name?: string; result_value?: string | null; is_error?: boolean | null }[] | null;
}

function parseJson(text: string | null | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function clock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The short text after the arrow on a tool row, written from what our own tool routes return. */
function outcome(tool: string, result: Record<string, unknown>, failed: boolean): string | null {
  if (failed) return "failed";
  switch (tool) {
    case "verify_patient":
      return result.verified === true ? "verified" : "not verified";
    case "get_available_appointments":
      return Array.isArray(result.slots) ? `${result.slots.length} slots` : null;
    case "book_appointment":
      return result.booked === true ? `confirmed${typeof result.when === "string" ? `, ${result.when}` : ""}` : "not booked";
    case "decline_followup":
      return "recorded";
    default:
      return null;
  }
}

/**
 * Spoken lines become { type: "line" } rows. Each request the agent made to one of our tool
 * routes becomes a { type: "tool" } row placed after the line it followed. The built-in
 * end_call tool is left out: it says nothing the last spoken line does not.
 */
export function toTranscriptItems(turns: ElevenLabsTurn[] | null | undefined): TranscriptItem[] {
  const list = Array.isArray(turns) ? turns : [];

  // A tool's result can arrive on a later turn than its request. Index every result first.
  const results = new Map<string, { value: Record<string, unknown>; failed: boolean }>();
  for (const turn of list) {
    for (const r of turn.tool_results ?? []) {
      if (r.request_id) results.set(r.request_id, { value: parseJson(r.result_value), failed: r.is_error === true });
    }
  }

  const items: TranscriptItem[] = [];
  for (const turn of list) {
    const text = turn.message?.trim();
    if (text) {
      items.push({ type: "line", t: clock(turn.time_in_call_secs), speaker: turn.role === "agent" ? "agent" : "patient", text });
    }
    for (const call of turn.tool_calls ?? []) {
      const tool = call.tool_name ?? "";
      if (!tool || tool === "end_call") continue;
      if (tool === "escalate_to_staff") {
        const question = parseJson(call.params_as_json).question;
        items.push({ type: "tool", text: `escalate_to_staff(${typeof question === "string" ? JSON.stringify(question) : ""})`, escalation: true });
        continue;
      }
      const result = call.request_id ? results.get(call.request_id) : undefined;
      const tail = result ? outcome(tool, result.value, result.failed) : null;
      items.push({ type: "tool", text: tail ? `${tool}() → ${tail}` : `${tool}()` });
    }
  }
  return items;
}
