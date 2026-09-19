import { fmtTime } from "@/lib/format";
import type { TimelineEvent, TimelineKind } from "@/lib/types";

const DOT: Record<TimelineKind, string> = {
  approval: "bg-green",
  call: "bg-blue",
  sms: "bg-blue",
  booking: "bg-green",
  problem: "bg-amber",
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-ink-2">No outreach yet. This patient is queued for the next recall run.</p>;
  return (
    <div className="flex flex-col">
      {events.map((e) => (
        <div key={e.at + e.label} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 border-t border-line py-[10px] first:border-t-0 first:pt-0 last:pb-0">
          <div className="pt-0.5 font-mono text-xs text-ink-2">{fmtTime(e.at)}</div>
          <div className="flex items-center gap-[10px] text-sm">
            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[e.kind]}`} />
            {e.label}
          </div>
        </div>
      ))}
    </div>
  );
}
