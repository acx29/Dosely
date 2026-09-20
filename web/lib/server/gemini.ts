// Server-side Gemini call behind the "Explain more" button. Never imported by browser code.
//
// Nothing here runs until a physician clicks the button on one drug row. One click is one
// Gemini request for that one patient and that one drug. The result is saved in
// matches.reason_text, so it is generated once and read from the database afterwards.
//
// The prompt follows the one in Rag/rag_agent.py (same inputs, same rules) and adds the rank and
// similarity score the vector search produced, so the explanation can refer to them.

import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.LLM_MODEL ?? "gemini-3.8-flash"; // same default model as Rag/rag_agent.py

export interface ExplainInput {
  patient: { diagnoses: string[] | null; current_prescriptions: string[] | null; relevant_notes: string | null };
  drug: {
    brand_name: string;
    drug_class: string | null;
    therapeutic_area: string | null;
    indications: string[] | null;
    target_patient_description: string | null;
    clinical_summary: string | null;
  };
  rank: number;
  similarity: number;
  outOf: number;
}

function apiKey(): string {
  // The key lives in the repo-root .env that the Rag scripts use. Next.js only reads web/.env.local
  // on its own, so load the root file once if the key is not already set.
  if (!process.env.GEMINI_API_KEY) {
    const rootEnv = path.join(process.cwd(), "..", ".env");
    if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  }
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in web/.env.local or the repo-root .env");
  return key;
}

/** The same patient text the vector search embedded: diagnoses, medications, and the visit note. */
export function patientContext(p: ExplainInput["patient"]): string {
  // Drop the operational "Follow-up is currently N days overdue" sentence, as rag_agent.py does.
  const notes = (p.relevant_notes ?? "").split("Follow-up is currently")[0]!.trim();
  const meds = p.current_prescriptions?.length ? p.current_prescriptions.join(", ") : "None listed";
  return `Clinical diagnoses:\n${(p.diagnoses ?? []).join(", ")}\n\nCurrent medications:\n${meds}\n\nRelevant clinical notes:\n${notes}`.trim();
}

export async function explainMatch(input: ExplainInput): Promise<string> {
  const { drug } = input;
  const prompt = `
You are generating a short explanation for a physician-facing
section called "Sponsored Pharmaceutical Matches."

PATIENT CLINICAL CONTEXT:

${patientContext(input.patient)}


SPONSORED PHARMACEUTICAL RECORD:

Drug:
${drug.brand_name}

Drug class:
${drug.drug_class ?? ""}

Therapeutic area:
${drug.therapeutic_area ?? ""}

Indications:
${JSON.stringify(drug.indications ?? [])}

Target patient description:
${drug.target_patient_description ?? ""}

Clinical summary:
${drug.clinical_summary ?? ""}


VECTOR SEARCH RESULT:

This record ranked ${input.rank} of ${input.outOf} for this patient.
Its cosine similarity to the patient context is ${input.similarity.toFixed(4)} on a scale of 0 to 1.
The score measures how close the wording of the patient context is to the wording of the drug record.
It is not a measure of clinical benefit.


TASK:

In 2-3 sentences, explain why this sponsored pharmaceutical record was surfaced for this
patient at this rank and similarity score, based only on the supplied patient context.
Name the specific parts of the patient context (diagnosis, medication, or visit note) that
overlap with the drug record.

RULES:

- Do not recommend the drug.
- Do not prescribe treatment.
- Do not say the patient should receive the drug.
- Do not make a clinical decision.
- Do not invent patient information.
- Only explain the contextual overlap between the patient
  record and pharmaceutical record.
- If the drug's listed indication directly matches a patient diagnosis,
  explicitly say that it is a direct indication match.
- If the indication does not directly match any patient diagnosis,
  explicitly state that there is no direct indication match and explain
  only the broader contextual similarity.
- Never imply that a drug is indicated for the patient's condition
  unless that indication appears in the supplied pharmaceutical record.
- Do not describe the similarity score as a probability, a confidence, or evidence of benefit.
`;

  const ai = new GoogleGenAI({ apiKey: apiKey() });
  const response = await ai.models.generateContent({ model: MODEL, contents: prompt });
  const text = response.text?.trim();
  if (!text) throw new Error("Gemini returned no text");
  return text;
}
