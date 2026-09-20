// GET /api/patients/overdue
// Recall activity list: every patient at the clinic who is overdue right now, with live status.

import { NextResponse } from "next/server";
import { CLINIC, db } from "@/lib/server/db";
import { whitelistedPatientIds } from "@/lib/server/live";
import { callDb } from "@/lib/server/rpc";
import type { OverdueRow } from "@/lib/types";

export const dynamic = "force-dynamic";

// A recall run spreads its contacts over at most 30 minutes. A contact record newer than this
// belongs to a run that may still be playing out.
const RUN_WINDOW_MINUTES = 35;

/** Patients a recall run has picked in the last 35 minutes. Their contact record already exists. */
async function pickedByCurrentRun(): Promise<Set<string>> {
  const since = new Date(Date.now() - RUN_WINDOW_MINUTES * 60_000).toISOString();
  const { data, error } = await db().from("outreach").select("patient_id").eq("clinic_name", CLINIC).gt("created_at", since);
  if (error) console.error("reading recent outreach failed:", error.message);
  return new Set((data ?? []).map((o) => String(o.patient_id)));
}

export async function GET() {
  const [activity, callable, picked] = await Promise.all([callDb("recall_activity", { p_clinic: CLINIC }), whitelistedPatientIds(), pickedByCurrentRun()]);
  if (activity.error) return NextResponse.json({ error: activity.error }, { status: 500 });

  // A picked patient still reads "queued" until the minute their call is stamped for. The server
  // refuses a second contact for them, so the row is marked and the screen leaves out its Call button.
  const rows = ((activity.data ?? []) as OverdueRow[]).map((r) => (r.status === "queued" && picked.has(r.id) ? { ...r, in_current_run: true } : r));

  // A patient whose stored phone is in DEMO_PHONE_WHITELIST goes first. The Queued group is the whole
  // backlog, thousands of rows, and this is the row somebody will want to find and click Call on.
  const first = new Set(callable.map(String));
  if (first.size === 0) return NextResponse.json(rows);
  return NextResponse.json([...rows.filter((r) => first.has(r.id)), ...rows.filter((r) => !first.has(r.id))]);
}
