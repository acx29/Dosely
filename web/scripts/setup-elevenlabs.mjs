// One-time setup of the ElevenLabs side of live calls. Run from the web/ folder:
//
//   node scripts/setup-elevenlabs.mjs
//
// What it does, in order, all through the ElevenLabs API:
//   1. Creates the five tools the voice agent uses. Each tool is an HTTP POST to one of this app's
//      routes under PUBLIC_BASE_URL/api/agent-tools/, with the AGENT_TOOL_SECRET header.
//   2. Creates the agent: the call script, the first line, and the five tools.
//   3. Imports the Twilio number (TWILIO_FROM_NUMBER) into ElevenLabs, so ElevenLabs can dial out from it.
//   4. Registers PUBLIC_BASE_URL/api/webhooks/elevenlabs/post-call as the post-call webhook.
//      This is a setting of the whole ElevenLabs workspace: it applies to every agent in the account.
//   5. Saves the agent id, phone number id and webhook secret to web/.elevenlabs.json. That file is
//      not committed. The app (lib/server/live.ts) reads it, so nothing has to be copied by hand.
//
// Safe to run again. It remembers what it made in web/.elevenlabs.json and
// updates those instead of making duplicates. Run it again whenever PUBLIC_BASE_URL changes, for
// example when ngrok gives out a new address: the tools and the webhook carry that address inside them.
//
// Reads web/.env.local first, then the repo-root .env for anything still unset.
// Needs: ELEVENLABS_API_KEY, PUBLIC_BASE_URL, AGENT_TOOL_SECRET, and for step 3
//        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [path.join(webDir, ".env.local"), path.join(webDir, "..", ".env")]) {
  if (existsSync(file)) process.loadEnvFile(file); // never overwrites a variable that is already set
}

const API = "https://api.elevenlabs.io";
const STATE_FILE = path.join(webDir, ".elevenlabs.json");
const env = (name) => process.env[name]?.trim() || undefined;

const apiKey = env("ELEVENLABS_API_KEY");
const baseUrl = env("PUBLIC_BASE_URL")?.replace(/\/+$/, "");
const toolSecret = env("AGENT_TOOL_SECRET");
const problems = [];
if (!apiKey) problems.push("ELEVENLABS_API_KEY is not set. Create one at elevenlabs.io > Developers > API keys.");
if (!baseUrl?.startsWith("https://")) problems.push("PUBLIC_BASE_URL must be the public https address that forwards to this app (the ngrok address), with no path.");
if (!toolSecret || toolSecret.length < 16) problems.push("AGENT_TOOL_SECRET must be set to a random text of at least 16 characters. Make one with:  openssl rand -hex 24");
if (problems.length > 0) {
  console.error("Cannot start:\n" + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
state.tools ??= {};
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

/** One ElevenLabs API request. Returns { status, body }. Never throws on an HTTP error status. */
async function request(method, urlPath, body) {
  const res = await fetch(API + urlPath, {
    method,
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

function stop(step, res) {
  console.error(`\n${step} failed. ElevenLabs answered ${res.status}:`);
  console.error(typeof res.body === "string" ? res.body : JSON.stringify(res.body, null, 2));
  process.exit(1);
}

/** Updates the thing with the remembered id, or creates it when there is none or it no longer exists. */
async function upsert(step, id, updatePath, createPath, body) {
  if (id) {
    const updated = await request("PATCH", updatePath(id), body);
    if (updated.ok) return { id, body: updated.body, created: false };
    if (updated.status !== 404) stop(step, updated);
  }
  const created = await request("POST", createPath, body);
  if (!created.ok) stop(step, created);
  return { id: undefined, body: created.body, created: true };
}

// ---------------------------------------------------------------------------------------------
// 1. Tools
// patient_id and outreach_id are filled by ElevenLabs from the call's dynamic variables (set when
// the app places the call). The language model never chooses them. A property filled that way
// must not also have a description: ElevenLabs allows only one of the two.
// ---------------------------------------------------------------------------------------------

const callIds = {
  patient_id: { type: "string", dynamic_variable: "patient_id" },
  outreach_id: { type: "string", dynamic_variable: "outreach_id" },
};

const TOOLS = [
  {
    name: "verify_patient",
    description:
      "Checks the date of birth the person said against the clinic's records. Call it once they have said their date of birth. Returns verified true or false. No other tool works until this has returned verified true.",
    properties: {
      date_of_birth: { type: "string", description: "The date of birth the person said, converted to the format YYYY-MM-DD, for example 1968-03-14." },
    },
    required: ["date_of_birth"],
  },
  {
    name: "get_available_appointments",
    description:
      "Returns up to three open appointment times with the patient's provider. Each has a slot_id and a 'when' text to read aloud exactly as written. Call it after the patient agrees to schedule, and again if a booking fails.",
    properties: {},
    required: [],
  },
  {
    name: "book_appointment",
    description:
      "Books one of the times returned by get_available_appointments. Call it only after the patient has confirmed the day and time you repeated back. Returns booked true with the 'when' text, or booked false with a reason. text_confirmation says whether a confirmation text was sent.",
    properties: { slot_id: { type: "string", description: "The slot_id of the time the patient chose, exactly as returned by get_available_appointments." } },
    required: ["slot_id"],
  },
  {
    name: "decline_followup",
    description: "Records that the patient does not want to schedule a follow-up now. Call it once, then thank them and end the call.",
    properties: {},
    required: [],
  },
  {
    name: "escalate_to_staff",
    description:
      "Passes a question or request to the clinic staff. Call it for every medical question, for anything you cannot answer, when none of the offered times work, and when identity cannot be verified.",
    properties: { question: { type: "string", description: "The question or request in the patient's own words, one or two sentences." } },
    required: ["question"],
  },
];

console.log(`Tools -> ${baseUrl}/api/agent-tools/...`);
for (const tool of TOOLS) {
  const body = {
    tool_config: {
      type: "webhook",
      name: tool.name,
      description: tool.description,
      response_timeout_secs: 20,
      api_schema: {
        url: `${baseUrl}/api/agent-tools/${tool.name}`,
        method: "POST",
        request_headers: { "x-dosely-tool-secret": toolSecret },
        request_body_schema: {
          type: "object",
          description: `Input for ${tool.name}.`,
          properties: { ...callIds, ...tool.properties },
          required: ["patient_id", "outreach_id", ...tool.required],
        },
      },
      dynamic_variables: { dynamic_variable_placeholders: { patient_id: "0", outreach_id: "0" } },
    },
  };
  const result = await upsert(`Tool ${tool.name}`, state.tools[tool.name], (id) => `/v1/convai/tools/${id}`, "/v1/convai/tools", body);
  state.tools[tool.name] = result.id ?? result.body.id;
  saveState();
  console.log(`  ${result.created ? "created" : "updated"} ${tool.name} (${state.tools[tool.name]})`);
}

// ---------------------------------------------------------------------------------------------
// 2. Agent. The script follows the project's call script line for line. The agent knows only what
// the dynamic variables carry: first name, clinic, provider, clinic phone. Nothing clinical.
// ---------------------------------------------------------------------------------------------

const PROMPT = `You are a virtual scheduling assistant calling on behalf of {{clinic_name}}. You are on a phone call. Your only job is to schedule a follow-up appointment for {{first_name}} with {{doctor_name}}.

Follow these steps in order.

1. Your first line asks to speak with {{first_name}}. If the person says {{first_name}} is not available, or that you have the wrong number, say you will try again another time, do not say why you are calling, and end the call. If you reach a voicemail greeting or an automated system, end the call without leaving a message.
2. Once you are speaking with {{first_name}}, say: "I'm a virtual scheduling assistant calling on behalf of {{clinic_name}}. This call may be recorded and transcribed for scheduling and quality purposes."
3. Say: "Before we continue, can you confirm your date of birth?" Convert what they say to YYYY-MM-DD and call verify_patient. If verified is false, ask them to repeat it once and call verify_patient again. If it is false a second time, say the clinic staff will call them, call escalate_to_staff with the question "Identity could not be verified on the call", and end the call.
4. After verified is true, say: "We noticed you're due for a follow-up appointment with your care team. Would you like me to help schedule one?"
5. If they say no, call decline_followup, thank them, and end the call.
6. If they say yes, call get_available_appointments. Read the times using the 'when' text exactly as returned. When they choose one, repeat the day and time back and ask them to confirm. After they confirm, call book_appointment with that slot_id.
7. If booked is false, apologise, call get_available_appointments again and offer the new times. If none of the times work for them, call escalate_to_staff with the days and times they prefer, tell them the clinic staff will call to arrange it, and end the call.
8. If booked is true, say: "You're scheduled for" followed by the 'when' text. If text_confirmation is true, add: "We'll send a confirmation by text." If it is false, do not mention a text.
9. Ask if there is anything else. Then say goodbye and end the call.

Rules.
- Scheduling only. You do not know, and must never guess or discuss, the patient's diagnoses, medications, test results or the medical reason for the follow-up.
- For any medical question, or any question you cannot answer, say: "I'll pass that to the clinic staff and they'll get back to you." Then call escalate_to_staff with the question in the patient's own words, and continue where you left off.
- Never mention any drug, pharmaceutical company or sponsor.
- Before verified is true, say nothing beyond the clinic name and that the call is about scheduling.
- If a tool returns an error, say the clinic staff will follow up, and end the call.
- If they ask for the clinic's number, it is {{clinic_phone}}.
- Speak in short sentences. Ask one question at a time. Say dates and times the way a person would say them aloud.`;

const agentBody = {
  name: "Dosely scheduling assistant",
  conversation_config: {
    agent: {
      first_message: "Hi, may I speak with {{first_name}}?",
      language: "en",
      prompt: {
        prompt: PROMPT,
        llm: env("ELEVENLABS_LLM") ?? "gemini-2.5-flash",
        temperature: 0.2,
        tool_ids: TOOLS.map((t) => state.tools[t.name]),
        built_in_tools: { end_call: { type: "system", name: "end_call", description: "", params: { system_tool_type: "end_call" } } },
      },
      // Sample values. ElevenLabs uses them only when the agent is tried out from its dashboard.
      dynamic_variables: {
        dynamic_variable_placeholders: {
          first_name: "John",
          clinic_name: "Joel's Clinic",
          clinic_phone: "(555) 014-9000",
          doctor_name: "Dr. Patel",
          patient_id: "0",
          outreach_id: "0",
        },
      },
    },
    conversation: { max_duration_seconds: 300 },
  },
};

// Only ever the agent this script made itself (state.agent_id). Never ELEVENLABS_AGENT_ID and never
// call_agent_id: those can name the agent the team wrote by hand, whose prompt must not be replaced.
const agent = await upsert("Agent", state.agent_id, (id) => `/v1/convai/agents/${id}`, "/v1/convai/agents/create", agentBody);
state.agent_id = agent.id ?? agent.body.agent_id;
saveState();
console.log(`Agent ${agent.created ? "created" : "updated"} (${state.agent_id})`);

// ---------------------------------------------------------------------------------------------
// 3. Twilio number. ElevenLabs needs the Twilio account's credentials to dial out from the number.
// enable_sms false: ElevenLabs must not take over the number's inbound texts.
// ---------------------------------------------------------------------------------------------

const fromRaw = env("TWILIO_FROM_NUMBER") ?? env("TWILIO_FROM");
const fromDigits = fromRaw?.replace(/\D/g, "") ?? "";
const from = fromRaw?.trim().startsWith("+") ? `+${fromDigits}` : fromDigits.length === 10 ? `+1${fromDigits}` : fromDigits.length === 11 ? `+${fromDigits}` : null;

const listed = await request("GET", "/v1/convai/phone-numbers");
if (!listed.ok) stop("Listing phone numbers", listed);
const numbers = Array.isArray(listed.body) ? listed.body : [];
const existing = numbers.find((n) => n.phone_number === from) ?? numbers.find((n) => n.phone_number_id === (state.phone_number_id ?? env("ELEVENLABS_PHONE_NUMBER_ID")));

if (existing) {
  state.phone_number_id = existing.phone_number_id;
  console.log(`Phone number ${existing.phone_number} is already in ElevenLabs (${state.phone_number_id})`);
} else if (!from || !env("TWILIO_ACCOUNT_SID") || !env("TWILIO_AUTH_TOKEN")) {
  console.log("Phone number: SKIPPED. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER, then run this again.");
} else {
  const importBody = { provider: "twilio", phone_number: from, label: "Dosely recall line", sid: env("TWILIO_ACCOUNT_SID"), token: env("TWILIO_AUTH_TOKEN") };
  let imported = await request("POST", "/v1/convai/phone-numbers", { ...importBody, enable_sms: false });
  if (imported.status === 422) imported = await request("POST", "/v1/convai/phone-numbers", importBody); // an API version without enable_sms
  if (!imported.ok) stop("Importing the Twilio number", imported);
  state.phone_number_id = imported.body.phone_number_id;
  console.log(`Phone number ${from} imported (${state.phone_number_id})`);
}
saveState();

// ---------------------------------------------------------------------------------------------
// 4. Post-call webhook. ElevenLabs shows the signing secret only once, in the create response.
// ---------------------------------------------------------------------------------------------

const webhookUrl = `${baseUrl}/api/webhooks/elevenlabs/post-call`;
let webhookSecret;
// "node scripts/setup-elevenlabs.mjs --new-webhook" makes a fresh webhook even when the address is
// unchanged. Use it when the secret printed the first time was lost.
if (state.webhook?.url === webhookUrl && !process.argv.includes("--new-webhook")) {
  console.log(`Post-call webhook already points at ${webhookUrl}`);
} else {
  // Calls work without this webhook. It only delivers what happens after a call: the transcript, and
  // the "nobody answered" notice that triggers the fallback text. So a failure here is reported and
  // the script carries on. The usual cause is an API key without the webhooks_write permission.
  const created = await request("POST", "/v1/workspace/webhooks", { settings: { auth_type: "hmac", name: "Dosely post-call", webhook_url: webhookUrl } });
  const settings = created.ok
    ? await request("PATCH", "/v1/convai/settings", {
        webhooks: { post_call_webhook_id: created.body.webhook_id, events: ["transcript", "call_initiation_failure"], send_audio: false },
      })
    : created;
  if (!settings.ok) {
    const detail = settings.body?.detail?.message ?? JSON.stringify(settings.body);
    console.log(`Post-call webhook: SKIPPED (ElevenLabs answered ${settings.status}: ${detail})`);
  } else {
    webhookSecret = created.body.webhook_secret;
    // The secret is kept in web/.elevenlabs.json, which is not committed. The app reads it from there.
    state.webhook = { id: created.body.webhook_id, url: webhookUrl, secret: webhookSecret };
    saveState();
    console.log(`Post-call webhook created -> ${webhookUrl}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 5. What to paste
// ---------------------------------------------------------------------------------------------

console.log("\nDone. Saved to web/.elevenlabs.json, which the app reads by itself. Nothing to copy.");
console.log(`  agent id        ${state.agent_id}`);
console.log(`  phone number id ${state.phone_number_id ?? "MISSING: the Twilio number was not imported, so calls cannot be placed yet"}`);
console.log(`  webhook secret  ${state.webhook?.secret ? "saved" : "none. Calls still work; transcripts and the no-answer text do not"}`);
