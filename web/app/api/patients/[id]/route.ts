// GET /api/patients/:id
// Patient card: follow-up status, clinical context, outreach timeline, texts, call summary.

import { NextResponse } from "next/server";
import { callDb, toId } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = toId((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  let { data, error } = await callDb("patient_card_with_panel", { p_patient: id });
  // Before db/sql/08_panels.sql has been run that function does not exist yet. Serve the card without a panel.
  if (error?.includes("Could not find the function")) {
    ({ data, error } = await callDb("patient_card", { p_patient: id }));
  }
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  // A card that carries sponsored matches counts as one view of each matched drug. The database
  // function records this at most once per patient per 30 minutes, so the 10-second refresh does not inflate it.
  const matches = (data as { sponsored_matches?: unknown[] }).sponsored_matches;
  if (Array.isArray(matches) && matches.length > 0) {
    await callDb("record_panel_view", { p_patient: id });
  }
  return NextResponse.json(data);
}
