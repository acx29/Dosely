// Shared handler for the routes under app/api/agent-tools/.
//
// During a call the ElevenLabs agent sends an HTTP POST to one of those routes whenever it needs
// something: check a date of birth, read open times, book, record a decline, pass on a question.
// Every request body carries patient_id and outreach_id. ElevenLabs fills those two from the
// call's dynamic variables (set in lib/server/live.ts placeCall). The language model cannot
// choose them, so a call can only ever act on the patient it was placed for.
//
// What the agent gets back is the JSON returned here. Expected outcomes ("date of birth does not
// match", "that time was just taken") are HTTP 200 with a plain message, so the agent can read
// them and carry on. Only a broken request or a database error is a non-200.

import "server-only";
import { NextResponse } from "next/server";
import { toolRequestAllowed } from "./live";
import { callDb } from "./rpc";

export interface ToolCall {
  outreach: number;
  patient: number;
  body: Record<string, unknown>;
}

/** Ids arrive as text ("251") because dynamic variables are text. Numbers are accepted too. */
export function toWholeNumber(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^\d{1,15}$/.test(text) ? Number(text) : null;
}

/** Runs a database function and returns its JSON, or throws with the database's message. */
export async function dbResult(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await callDb(fn, args);
  if (error) throw new Error(error);
  return (data ?? {}) as Record<string, unknown>;
}

export function toolRoute(name: string, handle: (call: ToolCall) => Promise<Record<string, unknown>>) {
  return async function POST(req: Request): Promise<NextResponse> {
    if (!toolRequestAllowed(req)) {
      console.error(`[agent-tool ${name}] refused: missing or wrong x-dosely-tool-secret header`);
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const outreach = toWholeNumber(body?.outreach_id);
    const patient = toWholeNumber(body?.patient_id);
    if (!body || outreach === null || patient === null) {
      console.error(`[agent-tool ${name}] refused: outreach_id and patient_id are required`);
      return NextResponse.json({ error: "outreach_id and patient_id are required" }, { status: 400 });
    }
    try {
      const result = await handle({ outreach, patient, body });
      console.log(`[agent-tool ${name}] outreach_id=${outreach} -> ${JSON.stringify(result)}`);
      return NextResponse.json(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[agent-tool ${name}] outreach_id=${outreach} failed: ${error}`);
      return NextResponse.json({ error }, { status: 500 });
    }
  };
}
