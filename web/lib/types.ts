// Shapes shared with api/. Keep in sync with contract.md.

export type OutreachStatus = "queued" | "calling" | "text_sent" | "booked" | "needs_attention" | "on_hold";

export interface OverdueRow {
  id: string;
  name: string;
  age: number;
  conditions: string[];
  last_visit: string; // ISO date
  months_overdue: number;
  status: OutreachStatus;
  has_sponsored_panel: boolean;
  booked_for?: string; // ISO datetime, present when status is "booked"
  /**
   * True on a "queued" row that a recall run has already picked. The run writes the contact record
   * at once but stamps the call a few minutes ahead, so the row still reads Queued until that minute.
   * Such a row cannot be called by hand, so it shows "Calling shortly" instead of a Call button.
   */
  in_current_run?: boolean;
  // Optional snapshot used by the review cards. The table ignores these.
  interval_months?: number;
  medications?: string[];
  last_lab?: { name: string; value: string; flag?: string };
  last_note?: string;
  consent?: string;
}

export interface WhyFact {
  label: string;
  value: string;
}

/** An ad shown to the physician. Rendered only when non-null. Never contains a score. */
export interface SponsoredPanelData {
  drug_id: string;
  brand_name: string;
  manufacturer: string;
  drug_class: string;
  ad_text: string;
  why_facts: WhyFact[];
  label_url: string;
}

/**
 * One result from the RAG pipeline (Rag/rag_agent.py): a partner drug found by vector similarity
 * to the patient's diagnoses, medications and visit notes. The pipeline returns the 5 nearest.
 */
export interface SponsoredMatch {
  rank: number;
  drug_id: string;
  brand_name: string;
  generic_name: string;
  company_name: string;
  therapeutic_area: string;
  drug_class: string;
  indications: string[];
  /** Cosine similarity between the patient text and the drug text, 0 to 1. */
  similarity: number;
  /** Gemini's explanation of why this record surfaced. Null until it has been generated. */
  why_surfaced: string | null;
  label_url: string;
}

export type TimelineKind = "approval" | "call" | "sms" | "booking" | "problem";

export interface TimelineEvent {
  at: string; // ISO datetime
  label: string;
  kind: TimelineKind;
}

export type TranscriptItem =
  | { type: "line"; t: string; speaker: "agent" | "patient"; text: string }
  | { type: "tool"; text: string; escalation?: boolean };

export interface SmsMessage {
  direction: "out" | "in";
  at: string; // ISO datetime
  text: string;
}

export interface CallSummary {
  channel: string;
  identity_verified: string;
  patient_response: string;
  duration: string;
}

export interface PatientCard {
  id: string;
  name: string;
  age: number;
  status: OutreachStatus;
  follow_up: {
    last_visit: string;
    interval_months: number;
    due: string;
    months_overdue: number;
  };
  clinical: {
    conditions: { name: string; icd10?: string }[];
    medications: string[];
    last_lab?: { name: string; value: string; date: string; flag?: string };
    note?: string;
  };
  appointment?: { at: string; with: string };
  action_needed: string[];
  call_summary?: CallSummary;
  timeline: TimelineEvent[];
  transcript?: { at: string; items: TranscriptItem[] };
  sms_thread: SmsMessage[];
  sponsored_panel: SponsoredPanelData | null;
  /** Top matches from the RAG pipeline, best first. Absent when reading fixtures. */
  sponsored_matches?: SponsoredMatch[];
}

export interface DoctorMetrics {
  period: string;
  visit_rate_usd: number;
  found: number;
  contacted: number;
  booked: number;
  seen: number;
  baseline_expected_returns: number;
  by_condition: { condition: string; overdue: number; booked: number; seen: number }[];
  needs_attention: { patient: string; reason: string }[];
}

export interface Campaign {
  drug_id: string;
  brand_name: string;
  label_name: string;
  manufacturer: string;
  therapeutic_area: string;
  panels_shown: number;
  physicians_reached: number;
  label_views: number;
  booked: number;
}

/** Aggregates only. No patient-level fields may ever be added here. */
export interface ImpiricusMetrics {
  period: string;
  practices_active: number;
  weekly_physician_opens: number;
  patients_recalled: number;
  visits_booked: number;
  campaigns: Campaign[];
}

export interface SidebarData {
  new_bookings: number;
  agent: { active: boolean; calls_in_progress: number; texts_awaiting_reply: number; booked_today: number };
  activity: { at: string; text: string; kind: TimelineKind }[];
}

export interface Provider {
  id: string;
  name: string;
  role: "physician" | "np";
}

/** Anything already on the practice calendar. Bookings made by the agent come from `bookings`, not from here. */
export interface CalendarEvent {
  id: string;
  provider_id: string;
  start: string; // ISO datetime
  end: string;
  label: string;
}

/** An appointment the agent booked. Firm when made; staff can keep, reschedule or reassign it. */
export interface Booking {
  id: string;
  patient_id: string;
  patient_name: string;
  age: number;
  conditions: string[];
  start: string;
  end: string;
  provider_id: string;
  months_overdue: number;
  via: string;
  note: string;
  review_state: "new" | "kept";
  alt_slots: { slot_id: string; start: string; end: string }[];
  reassign_options: string[]; // provider ids free at the same time
}

export interface ScheduleData {
  week_start: string; // ISO date, a Monday
  providers: Provider[];
  events: CalendarEvent[];
  bookings: Booking[];
}
