import type { OutreachStatus } from "@/lib/types";

export type Tone = "neutral" | "green" | "blue" | "amber" | "red" | "hold";

const TONES: Record<Tone, string> = {
  neutral: "bg-fill text-ink-3",
  green: "bg-green-bg text-green-dk",
  blue: "bg-blue-bg text-blue",
  amber: "bg-amber-bg text-amber",
  red: "bg-red-bg text-red",
  hold: "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-3)]",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-[10px] py-1 text-[11.5px] font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS: Record<OutreachStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  calling: { label: "Calling", tone: "blue" },
  text_sent: { label: "Text sent", tone: "blue" },
  booked: { label: "Booked", tone: "green" },
  needs_attention: { label: "Needs attention", tone: "amber" },
  on_hold: { label: "On hold", tone: "hold" },
};

export function StatusPill({ status }: { status: OutreachStatus }) {
  const s = STATUS[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
