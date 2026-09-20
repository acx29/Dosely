// POST /api/appointments/:id/reschedule   { slot_id: string }
// Moves a booking to another open time with the same provider. The database function claims
// the new slot first and only then frees the old one, in one transaction, so two people can
// never end up in the same slot. It also records the text that tells the patient the new time.

import { NextResponse } from "next/server";
import { callDb, toId } from "@/lib/server/rpc";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = toId((await ctx.params).id);
  const body = (await req.json().catch(() => null)) as { slot_id?: unknown } | null;
  const slot = typeof body?.slot_id === "string" ? toId(body.slot_id) : null;
  if (id === null || slot === null) {
    return NextResponse.json({ error: "expected a numeric appointment id and { slot_id }" }, { status: 400 });
  }

  const { data, error } = await callDb("reschedule_booking", { p_appointment: id, p_slot: slot });
  // 409 when the slot was taken in the meantime: the screen can offer the other times.
  if (error) return NextResponse.json({ error }, { status: error.includes("just taken") ? 409 : 500 });
  return NextResponse.json(data);
}
