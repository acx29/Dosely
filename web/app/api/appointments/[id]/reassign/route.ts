// POST /api/appointments/:id/reassign   { provider_id: string }
// Same time, different provider at the same clinic. The database function claims the other
// provider's slot at that time, frees the original one, and records the text that tells the
// patient who they will see.

import { NextResponse } from "next/server";
import { callDb, toId } from "@/lib/server/rpc";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = toId((await ctx.params).id);
  const body = (await req.json().catch(() => null)) as { provider_id?: unknown } | null;
  const provider = typeof body?.provider_id === "string" ? toId(body.provider_id) : null;
  if (id === null || provider === null) {
    return NextResponse.json({ error: "expected a numeric appointment id and { provider_id }" }, { status: 400 });
  }

  const { data, error } = await callDb("reassign_booking", { p_appointment: id, p_provider: provider });
  // 409 when that provider is no longer free at that time.
  if (error) return NextResponse.json({ error }, { status: error.includes("not free") ? 409 : 500 });
  return NextResponse.json(data);
}
