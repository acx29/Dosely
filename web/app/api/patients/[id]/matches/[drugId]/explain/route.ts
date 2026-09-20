// POST /api/patients/:id/matches/:drugId/explain
// The "Explain more" button. Asks Gemini why this drug surfaced for this patient at its rank and
// similarity score, saves the answer on the match row, and returns it.
// If an explanation is already saved, it is returned as is and Gemini is not called.

import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { explainMatch } from "@/lib/server/gemini";
import { toId } from "@/lib/server/rpc";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; drugId: string }> }) {
  const params = await ctx.params;
  const patientId = toId(params.id);
  const drugId = toId(params.drugId);
  if (patientId === null || drugId === null) {
    return NextResponse.json({ error: "expected numeric patient and drug ids" }, { status: 400 });
  }

  const sb = db();
  const { data: rows, error: matchError } = await sb.from("matches").select("drug_id, rank, similarity, reason_text").eq("patient_id", patientId);
  if (matchError) return NextResponse.json({ error: matchError.message }, { status: 500 });
  const match = rows?.find((r) => r.drug_id === drugId);
  if (!match) return NextResponse.json({ error: "this drug is not one of the patient's saved matches" }, { status: 404 });
  if (match.reason_text) return NextResponse.json({ why_surfaced: match.reason_text, cached: true });

  const [{ data: patient, error: patientError }, { data: drug, error: drugError }] = await Promise.all([
    sb.from("ehr_patients").select("diagnoses, current_prescriptions, relevant_notes").eq("id", patientId).single(),
    sb.from("pharma_drugs").select("brand_name, drug_class, therapeutic_area, indications, target_patient_description, clinical_summary").eq("id", drugId).single(),
  ]);
  if (patientError || drugError || !patient || !drug) {
    return NextResponse.json({ error: patientError?.message ?? drugError?.message ?? "patient or drug not found" }, { status: 500 });
  }

  let text: string;
  try {
    text = await explainMatch({ patient, drug, rank: match.rank, similarity: Number(match.similarity), outOf: rows!.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`explain failed for patient ${patientId}, drug ${drugId}:`, message);
    // 429 lets the button tell a rate limit apart from a real failure.
    return NextResponse.json({ error: message }, { status: /429|RESOURCE_EXHAUSTED|rate/i.test(message) ? 429 : 502 });
  }

  const { error: saveError } = await sb.from("matches").update({ reason_text: text }).eq("patient_id", patientId).eq("drug_id", drugId);
  if (saveError) console.error("could not save the explanation:", saveError.message);

  return NextResponse.json({ why_surfaced: text, cached: false });
}
