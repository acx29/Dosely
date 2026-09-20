// Real phone calls and texts. Server-side only. Never imported by browser code.
//
// The dialing rule, enforced here and nowhere else:
//   1. DEMO_PHONE_WHITELIST lists the only numbers this app may ever call or text.
//   2. The number used for a patient is their stored phone if it is in that list,
//      otherwise the FIRST number in the list. Seeded patients have fictional 555 numbers, so in
//      practice every call and text goes to the team's own phone, whatever the screen shows.
//   3. placeCall and sendSms check the final number against the list again and refuse anything else.
//   4. An empty list switches real calling off. The Call button then runs the simulated contact.
//
// Calls go through the ElevenLabs API, which dials out over the Twilio number imported into
// ElevenLabs (web/scripts/setup-elevenlabs.mjs does that import). Texts go straight to Twilio.

import "server-only";
import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CLINIC } from "./db";
import { callDb } from "./rpc";

const ELEVENLABS_API = "https://api.elevenlabs.io";

// How long the phone rings before the call counts as "no answer". Carrier voicemail usually
// picks up after 25 to 30 seconds, and a voicemail pickup looks like an answered call.
// 20 seconds ends the attempt before that, so an unanswered call goes to the fallback text.
const RING_SECONDS = Number(process.env.CALL_RING_SECONDS ?? 20);

// The Twilio settings live in the repo-root .env that the other scripts use. Next.js only reads
// web/.env.local on its own, so the root file is loaded once, the first time a setting is missing.
// loadEnvFile never overwrites a variable that is already set.
let rootEnvLoaded = false;
function env(name: string): string | undefined {
  if (!process.env[name] && !rootEnvLoaded) {
    rootEnvLoaded = true;
    const rootEnv = path.join(process.cwd(), "..", ".env");
    try {
      if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
    } catch (err) {
      console.error("could not read the repo-root .env:", err);
    }
  }
  return process.env[name]?.trim() || undefined;
}

/** "+15405550123" from "(540) 555-0123". US numbers only. Same rules as dosely_e164 in db/sql/10_live_calls.sql. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** DEMO_PHONE_WHITELIST as E.164 numbers, in the order written. Separate numbers with commas. */
export function whitelist(): string[] {
  const numbers = (env("DEMO_PHONE_WHITELIST") ?? "")
    .split(/[,;\n]/)
    .map((n) => toE164(n))
    .filter((n): n is string => n !== null);
  return [...new Set(numbers)];
}

/** Rule 2 above. Null when the whitelist is empty. */
export function dialTarget(storedPhone: string | null | undefined): string | null {
  const list = whitelist();
  const own = toE164(storedPhone);
  return own && list.includes(own) ? own : (list[0] ?? null);
}

/**
 * Ids of the clinic's patients whose stored phone is in the whitelist. In practice this is the one
 * patient row that carries a team member's own name, date of birth and phone. "Run recall now"
 * passes them over, so they are still Queued when someone clicks Call, and the Recall list shows
 * them first. Empty when the whitelist is empty, or when db/sql/10_live_calls.sql has not been run yet.
 */
export async function whitelistedPatientIds(): Promise<number[]> {
  const phones = whitelist();
  if (phones.length === 0) return [];
  const { data, error } = await callDb("live_patient_ids", { p_phones: phones, p_clinic: CLINIC });
  return error || !Array.isArray(data) ? [] : data.map(Number).filter(Number.isFinite);
}

/** "***-***-0123", for log lines and API responses. */
export function masked(phone: string): string {
  return `***-***-${phone.slice(-4)}`;
}

type ElevenLabsConfig = { apiKey: string; agentId: string; phoneNumberId: string };

// scripts/setup-elevenlabs.mjs writes what it created to web/.elevenlabs.json (not committed).
// The agent id, phone number id and webhook secret are read from there when the matching
// environment variable is not set, so nothing has to be copied by hand after running the script.
// Read on every use: the script can be run again while the app is running.
//
// call_agent_id names the agent that calls are placed through: "Scheduling agent for Dosely", the
// agent the team wrote by hand in the ElevenLabs dashboard. The setup script never reads or writes
// that key, so running the script cannot change that agent or its prompt. agent_id is the agent
// the script itself created; it is used only when call_agent_id is absent.
function setupFile(): { call_agent_id?: string; agent_id?: string; phone_number_id?: string; webhook?: { secret?: string } } {
  try {
    const file = path.join(process.cwd(), ".elevenlabs.json");
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ReturnType<typeof setupFile>) : {};
  } catch {
    return {};
  }
}

/** The three settings a call needs, or the names of the ones that are missing. */
export function elevenLabsConfig(): ElevenLabsConfig | { missing: string[] } {
  const apiKey = env("ELEVENLABS_API_KEY");
  const agentId = env("ELEVENLABS_AGENT_ID") ?? setupFile().call_agent_id ?? setupFile().agent_id;
  const phoneNumberId = env("ELEVENLABS_PHONE_NUMBER_ID") ?? setupFile().phone_number_id;
  if (apiKey && agentId && phoneNumberId) return { apiKey, agentId, phoneNumberId };
  const missing = [
    ["ELEVENLABS_API_KEY", apiKey],
    ["ELEVENLABS_AGENT_ID", agentId],
    ["ELEVENLABS_PHONE_NUMBER_ID", phoneNumberId],
  ] as const;
  return { missing: missing.filter(([, value]) => !value).map(([name]) => name) };
}

export const webhookSecret = () => env("ELEVENLABS_WEBHOOK_SECRET") ?? setupFile().webhook?.secret;

/** What start_live_call (db/sql/10_live_calls.sql) returns for a live call. */
export interface LiveCall {
  outreach_id: number;
  patient_id: number;
  first_name: string;
  phone: string | null; // the stored phone, not necessarily the one dialed
  clinic_name: string;
  clinic_phone: string;
  doctor_name: string; // with the title, for example "Dr. Patel"
}

/** Chart fields the "Scheduling agent for Dosely" prompt uses. Read by the Call route, not by start_live_call. */
export interface CallChart {
  patient_name: string; // "Mike Dornic"
  date_of_birth: string; // "March 14, 1968". The agent compares what the person says against this.
  diagnosis: string; // the first documented condition
}

export type PlaceCallResult = { ok: true; to: string; callSid: string | null; conversationId: string | null } | { ok: false; error: string };

/**
 * Asks ElevenLabs to dial. ElevenLabs starts the agent named by ELEVENLABS_AGENT_ID and dials out
 * over the Twilio number named by ELEVENLABS_PHONE_NUMBER_ID.
 *
 * dynamic_variables fill the {{placeholders}} in the agent's prompt and first message. They are the
 * whole of what the voice agent knows about the patient. The agent's prompt uses five of them:
 * clinic_name, doctor_name, patient_name, date_of_birth and diagnosis. It checks the date of birth
 * itself, and its prompt forbids saying the date of birth or the diagnosis before that check passes.
 * ElevenLabs refuses to start a call when a variable the prompt uses is missing, so all five are always sent.
 * No medication, drug or sponsor data is ever sent.
 *
 * doctor_name goes without its title ("Patel"), because the prompt writes "Dr. {{doctor_name}}" itself.
 * first_name, patient_id and outreach_id are for the script-made agent and its tools; this agent ignores them.
 */
export async function placeCall(call: LiveCall, chart: CallChart): Promise<PlaceCallResult> {
  const config = elevenLabsConfig();
  if ("missing" in config) return { ok: false, error: `missing settings: ${config.missing.join(", ")}` };
  const to = dialTarget(call.phone);
  if (!to || !whitelist().includes(to)) return { ok: false, error: "DEMO_PHONE_WHITELIST is empty, so no number may be called" };

  console.log(`[live] outreach_id=${call.outreach_id} placing call to ${masked(to)}`);
  try {
    const res = await fetch(`${ELEVENLABS_API}/v1/convai/twilio/outbound-call`, {
      method: "POST",
      headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: config.agentId,
        agent_phone_number_id: config.phoneNumberId,
        to_number: to,
        conversation_initiation_client_data: {
          dynamic_variables: {
            clinic_name: call.clinic_name,
            doctor_name: call.doctor_name.replace(/^(Dr\.|NP)\s+/, ""),
            patient_name: chart.patient_name,
            date_of_birth: chart.date_of_birth,
            diagnosis: chart.diagnosis,
            first_name: call.first_name,
            clinic_phone: call.clinic_phone,
            patient_id: String(call.patient_id),
            outreach_id: String(call.outreach_id),
          },
        },
        telephony_call_config: { ringing_timeout_secs: RING_SECONDS },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let body: { success?: boolean; message?: string; conversation_id?: string | null; callSid?: string | null } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      // not JSON: the raw text goes into the error below
    }
    if (!res.ok || body.success !== true) {
      const error = `ElevenLabs answered ${res.status}: ${body.message ?? text.slice(0, 300)}`;
      console.error(`[live] outreach_id=${call.outreach_id} call not placed. ${error}`);
      return { ok: false, error };
    }
    console.log(`[live] outreach_id=${call.outreach_id} call placed, call_sid=${body.callSid} conversation_id=${body.conversation_id}`);
    return { ok: true, to, callSid: body.callSid ?? null, conversationId: body.conversation_id ?? null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[live] outreach_id=${call.outreach_id} call not placed. ${error}`);
    return { ok: false, error };
  }
}

export type SendSmsResult = { ok: true; sid: string; status: string } | { ok: false; error: string };

/**
 * Sends one text through Twilio's REST API. storedPhone goes through the same dialing rule as calls.
 * Settings: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (TWILIO_FROM also accepted).
 */
export async function sendSms(outreachId: number, storedPhone: string | null, text: string): Promise<SendSmsResult> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const from = toE164(env("TWILIO_FROM_NUMBER") ?? env("TWILIO_FROM"));
  if (!sid || !token || !from) return { ok: false, error: "Twilio settings are missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)" };
  const to = dialTarget(storedPhone);
  if (!to || !whitelist().includes(to)) return { ok: false, error: "DEMO_PHONE_WHITELIST is empty, so no number may be texted" };

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string };
    if (!res.ok || !body.sid) {
      const error = `Twilio answered ${res.status}: ${body.message ?? "no message id returned"}`;
      console.error(`[live] outreach_id=${outreachId} text not sent. ${error}`);
      return { ok: false, error };
    }
    console.log(`[live] outreach_id=${outreachId} text sent to ${masked(to)}, message_sid=${body.sid}`);
    return { ok: true, sid: body.sid, status: body.status ?? "queued" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[live] outreach_id=${outreachId} text not sent. ${error}`);
    return { ok: false, error };
  }
}

/**
 * Every tool request from the voice agent must carry the header  x-dosely-tool-secret  with the
 * value of AGENT_TOOL_SECRET. The setup script writes that header into each tool's configuration.
 * With no secret set, every tool request is refused.
 */
export function toolRequestAllowed(req: Request): boolean {
  const secret = env("AGENT_TOOL_SECRET");
  const sent = req.headers.get("x-dosely-tool-secret");
  if (!secret || !sent) return false;
  const a = Buffer.from(secret, "utf8");
  const b = Buffer.from(sent, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
