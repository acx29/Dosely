// POST /api/patients/:id/hold   { held: boolean }
// The brake: a held patient is skipped by every recall run until released.

import { NextResponse } from "next/server";
import { respond, toId } from "@/lib/server/rpc";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = toId((await ctx.params).id);
  const body = (await req.json().catch(() => null)) as { held?: unknown } | null;
  if (id === null || typeof body?.held !== "boolean") {
    return NextResponse.json({ error: "expected a numeric patient id and { held: boolean }" }, { status: 400 });
  }
  return respond("set_patient_hold", { p_patient: id, p_held: body.held });
}
