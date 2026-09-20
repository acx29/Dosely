// GET /api/patients/:id
// Patient card: follow-up status, clinical context, outreach timeline, texts, call summary.

import { NextResponse } from "next/server";
import { callDb, toId } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = toId((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data, error } = await callDb("patient_card", { p_patient: id });
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
