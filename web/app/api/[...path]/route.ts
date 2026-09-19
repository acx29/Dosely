// Fallback for every /api/... endpoint that is not live yet.
//
// lib/api.ts switches all of its functions to HTTP at once when NEXT_PUBLIC_API_URL is set.
// This file answers the ones that do not have their own route yet with the same fixture
// data the screens used before, so screens can be moved to the database one at a time.
// A more specific route file (for example app/api/metrics/doctor/route.ts) always wins
// over this one. Delete an entry here when its real route exists.

import { NextResponse } from "next/server";
import overdue from "@/fixtures/overdue.json";
import patients from "@/fixtures/patients.json";
import impiricusMetrics from "@/fixtures/metrics-impiricus.json";
import sidebar from "@/fixtures/sidebar.json";
import schedule from "@/fixtures/schedule.json";
import type { OverdueRow, PatientCard } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

function patientCard(id: string): PatientCard | null {
  const detailed = (patients as unknown as Record<string, PatientCard>)[id];
  if (detailed) return detailed;

  // Same fallback lib/api.ts uses against fixtures: a bare card built from the queue row.
  const row = (overdue as unknown as OverdueRow[]).find((r) => r.id === id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    age: row.age,
    status: row.status,
    follow_up: { last_visit: row.last_visit, interval_months: 6, due: row.last_visit, months_overdue: row.months_overdue },
    clinical: { conditions: row.conditions.map((name) => ({ name })), medications: [] },
    action_needed: [],
    timeline: [],
    sms_thread: [],
    sponsored_panel: null,
  };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");

  if (route === "patients/overdue") return NextResponse.json(overdue);
  if (route === "metrics/impiricus") return NextResponse.json(impiricusMetrics);
  if (route === "activity/summary") return NextResponse.json(sidebar);
  if (route === "schedule") return NextResponse.json(schedule);

  if (path.length === 2 && path[0] === "patients") {
    const card = patientCard(path[1]!);
    return card ? NextResponse.json(card) : NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ error: `no route for /api/${route}` }, { status: 404 });
}

// Button actions (run recall, hold, keep, reschedule, reassign) are accepted and ignored
// until their real routes exist. The screens already update optimistically.
export async function POST() {
  return new NextResponse(null, { status: 204 });
}
