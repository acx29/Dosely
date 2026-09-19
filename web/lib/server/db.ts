// Database connection for server-side code only.
//
// The "server-only" import makes the build fail if any browser-side component ever
// imports this file, so the secret key can never end up in code sent to the browser.
// Only route handlers under app/api/ use it.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set in web/.env.local");
  }
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** The practice the doctor screens show. Same text as ehr_doctors.clinic_name. */
export const CLINIC = process.env.CLINIC_NAME ?? "Joel's Clinic";

export const VISIT_RATE_USD = Number(process.env.VISIT_RATE_USD ?? 150);

/** Share of overdue patients expected to come back with no outreach. Used for incremental revenue. */
export const BASELINE_RETURN_RATE = Number(process.env.BASELINE_RETURN_RATE ?? 0.075);
