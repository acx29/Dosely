// GET /api/metrics/doctor
// Live numbers for the Practice performance screen. Every value is counted from the
// events table by the doctor_metrics SQL function (db/sql/02_metrics_functions.sql).

import { NextResponse } from "next/server";
import { BASELINE_RETURN_RATE, CLINIC, VISIT_RATE_USD, db } from "@/lib/server/db";
import type { DoctorMetrics } from "@/lib/types";

export const dynamic = "force-dynamic"; // never cache: the numbers change as events land

const DAYS = 90;

export async function GET() {
  const { data, error } = await db().rpc("doctor_metrics", { p_clinic: CLINIC, p_days: DAYS });
  if (error) {
    console.error("doctor_metrics failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts = data as Pick<DoctorMetrics, "found" | "contacted" | "booked" | "seen" | "by_condition" | "needs_attention">;
  const body: DoctorMetrics = {
    period: `Last ${DAYS} days`,
    visit_rate_usd: VISIT_RATE_USD,
    found: counts.found,
    contacted: counts.contacted,
    booked: counts.booked,
    seen: counts.seen,
    baseline_expected_returns: Math.round(counts.found * BASELINE_RETURN_RATE),
    by_condition: counts.by_condition,
    needs_attention: counts.needs_attention,
  };
  return NextResponse.json(body);
}
