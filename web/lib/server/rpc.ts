// One helper for every API route: call a database function, return its JSON, or a 500 with the reason.

import "server-only";
import { NextResponse } from "next/server";
import { db } from "./db";

export async function callDb(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: string | null }> {
  const { data, error } = await db().rpc(fn, args);
  if (error) console.error(`${fn} failed:`, error.message);
  return { data, error: error?.message ?? null };
}

export async function respond(fn: string, args: Record<string, unknown>): Promise<NextResponse> {
  const { data, error } = await callDb(fn, args);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json(data);
}

/** Path ids arrive as text. Database ids are whole numbers. Returns null for anything else. */
export function toId(value: string): number | null {
  return /^\d{1,15}$/.test(value) ? Number(value) : null;
}
