// GET /api/metrics/impiricus
// Network totals for the Impiricus page. Counts only: the database function returns no patient,
// physician or practice identifiers. Campaign rows come from sponsored-panel events, which exist
// only once the matcher writes to the matches table, so the list is empty until then.

import { NextResponse } from "next/server";
import { callDb } from "@/lib/server/rpc";
import type { ImpiricusMetrics } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAYS = 30;

export async function GET() {
  const { data, error } = await callDb("impiricus_overview", { p_days: DAYS });
  if (error) return NextResponse.json({ error }, { status: 500 });

  const totals = data as Pick<ImpiricusMetrics, "practices_active" | "weekly_physician_opens" | "patients_recalled" | "visits_booked">;
  const body: ImpiricusMetrics = { period: `Last ${DAYS} days`, ...totals, campaigns: [] };
  return NextResponse.json(body);
}
