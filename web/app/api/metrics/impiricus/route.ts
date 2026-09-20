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
  const [overview, campaigns] = await Promise.all([
    callDb("impiricus_overview", { p_days: DAYS }),
    callDb("impiricus_campaigns", { p_days: DAYS }),
  ]);
  if (overview.error) return NextResponse.json({ error: overview.error }, { status: 500 });

  const totals = overview.data as Pick<ImpiricusMetrics, "practices_active" | "weekly_physician_opens" | "patients_recalled" | "visits_booked">;
  const body: ImpiricusMetrics = {
    period: `Last ${DAYS} days`,
    ...totals,
    // Empty until a physician has opened a card that carries a panel. Also empty if 08_panels.sql has not been run yet.
    campaigns: campaigns.error ? [] : (campaigns.data as ImpiricusMetrics["campaigns"]),
  };
  return NextResponse.json(body);
}
