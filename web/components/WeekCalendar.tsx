import { dayKey, fmtTime, hourOfDay } from "@/lib/format";
import type { Booking, CalendarEvent } from "@/lib/types";

const START_HOUR = 8;
const END_HOUR = 17;
const HOUR_PX = 60;

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function place(start: string, end: string): React.CSSProperties {
  const s = hourOfDay(start);
  const e = hourOfDay(end);
  return { top: (s - START_HOUR) * HOUR_PX + 1, height: Math.max(18, (e - s) * HOUR_PX - 3) };
}

export function WeekCalendar({ weekStart, events, bookings }: { weekStart: string; events: CalendarEvent[]; bookings: Booking[] }) {
  const days = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const grid = "grid grid-cols-[52px_repeat(5,minmax(0,1fr))]";

  return (
    <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className={`${grid} bg-subtle`}>
        <div />
        {days.map((d) => {
          const date = new Date(`${d}T12:00:00Z`);
          return (
            <div key={d} className="flex items-baseline gap-1.5 border-l border-line px-3 py-[10px]">
              <span className="text-xs text-ink-2">{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date)}</span>
              <span className="text-[15px] font-semibold">{date.getUTCDate()}</span>
            </div>
          );
        })}
      </div>

      <div className={grid}>
        <div>
          {hours.map((h) => (
            <div key={h} className="border-t border-line pr-2 pt-1 text-right font-mono text-[10.5px] text-ink-2" style={{ height: HOUR_PX }}>
              {((h - 1) % 12) + 1} {h < 12 ? "AM" : "PM"}
            </div>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className="relative border-l border-line">
            {hours.map((h) => (
              <div key={h} className="border-t border-line" style={{ height: HOUR_PX }} />
            ))}
            {events
              .filter((e) => dayKey(e.start) === d)
              .map((e) => (
                <div
                  key={e.id}
                  className="absolute inset-x-1 overflow-hidden whitespace-nowrap rounded-md border border-line bg-subtle px-2 py-1 text-[11.5px] text-ink-3"
                  style={place(e.start, e.end)}
                >
                  <span className="font-mono text-[10.5px] text-ink-2">{fmtTime(e.start).replace(/ (AM|PM)/, "")}</span> {e.label}
                </div>
              ))}
            {bookings
              .filter((b) => dayKey(b.start) === d)
              .map((b) => (
                <div
                  key={b.id}
                  className="absolute inset-x-1 flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border border-[#9CC7B5] bg-green-bg px-2 py-1 text-[11.5px] font-semibold text-green-dk"
                  style={place(b.start, b.end)}
                >
                  {b.review_state === "new" ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green" /> : null}
                  <span className="font-mono text-[10.5px] font-medium">{fmtTime(b.start).replace(/ (AM|PM)/, "")}</span> {b.patient_name}
                </div>
              ))}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 border-t border-line px-4 py-[10px] text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[10px] w-[10px] rounded-[3px] border border-[#9CC7B5] bg-green-bg" />
          Booked by Dosely
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[10px] w-[10px] rounded-[3px] border border-line bg-subtle" />
          Existing appointments
        </span>
        <span className="ml-auto">Synced with the practice calendar</span>
      </div>
    </section>
  );
}
