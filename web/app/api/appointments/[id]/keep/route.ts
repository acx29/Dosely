// POST /api/appointments/:id/keep
// "Looks good". Clears the "new" badge on a booking the agent made. The booking was already
// firm, so nothing changes for the patient and no text is sent.

import { NextResponse } from "next/server";
import { respond, toId } from "@/lib/server/rpc";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = toId((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "expected a numeric appointment id" }, { status: 400 });
  return respond("keep_booking", { p_appointment: id });
}
