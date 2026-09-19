"use client";

import { useCallback, useMemo, useState } from "react";
import { keepBooking, reassignBooking, rescheduleBooking } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Booking, ScheduleData } from "@/lib/types";
import { BookingDeck } from "./BookingDeck";
import { Pill } from "./Pill";
import { WeekCalendar } from "./WeekCalendar";

/** Owns the bookings state so the calendar, the rail and the card deck always agree. */
export function ScheduleView({ data }: { data: ScheduleData }) {
  const [bookings, setBookings] = useState<Booking[]>(data.bookings);
  const [provider, setProvider] = useState(data.providers[0]?.id ?? "");
  const [view, setView] = useState<"calendar" | "cards">("calendar");
  const [open, setOpen] = useState<{ id: string; mode: "reschedule" | "reassign" } | null>(null);

  const fresh = useMemo(() => bookings.filter((b) => b.review_state === "new"), [bookings]);
  const nameOf = useCallback((id: string) => data.providers.find((p) => p.id === id)?.name ?? id, [data.providers]);
  const patch = useCallback((id: string, change: Partial<Booking>) => setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...change } : b))), []);

  const keep = useCallback(
    (id: string) => {
      patch(id, { review_state: "kept" });
      keepBooking(id).catch(console.error);
    },
    [patch],
  );
  const reschedule = useCallback(
    (id: string, slotId: string) => {
      const slot = bookings.find((b) => b.id === id)?.alt_slots.find((s) => s.slot_id === slotId);
      if (slot) patch(id, { start: slot.start, end: slot.end, review_state: "kept" });
      setOpen(null);
      rescheduleBooking(id, slotId).catch(console.error);
    },
    [bookings, patch],
  );
  const reassign = useCallback(
    (id: string, providerId: string) => {
      patch(id, { provider_id: providerId, review_state: "kept" });
      setOpen(null);
      reassignBooking(id, providerId).catch(console.error);
    },
    [patch],
  );

  const seg = (on: boolean) => `h-8 rounded-md px-3 text-[13px] font-medium ${on ? "bg-surface text-ink shadow-[0_1px_2px_rgba(28,27,24,0.08)]" : "text-ink-2 hover:text-ink"}`;
  const small = "h-7 rounded-[7px] border border-line-2 bg-surface px-[10px] text-xs font-medium text-ink-3 hover:bg-subtle";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Schedule</h1>
          <p className="text-sm text-ink-2">
            Week of {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${data.week_start}T12:00:00Z`))} ·{" "}
            <span className="font-medium text-green-dk">{fresh.length} new bookings from recall</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-lg bg-fill p-0.5" role="group" aria-label="Schedule view">
            <button type="button" className={seg(view === "calendar")} aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>
              Calendar
            </button>
            <button type="button" className={seg(view === "cards")} aria-pressed={view === "cards"} onClick={() => setView("cards")}>
              Review cards
            </button>
          </div>
          {view === "calendar" ? (
            <div className="flex items-center gap-1.5">
              {data.providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={provider === p.id}
                  onClick={() => setProvider(p.id)}
                  className={`h-[30px] rounded-full border px-3 text-[12.5px] font-medium ${
                    provider === p.id ? "border-ink bg-ink text-white" : "border-line-2 bg-surface text-ink-3 hover:border-line-3"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {view === "cards" ? (
        <div className="pt-4">
          <BookingDeck bookings={bookings} providers={data.providers} onKeep={keep} onReschedule={reschedule} onReassign={reassign} onExit={() => setView("calendar")} />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-5">
          <WeekCalendar
            weekStart={data.week_start}
            events={data.events.filter((e) => e.provider_id === provider)}
            bookings={bookings.filter((b) => b.provider_id === provider)}
          />

          <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
            <div className="flex items-center justify-between px-[18px] py-4">
              <h2 className="text-[13px] font-medium text-ink-2">Booked by Dosely</h2>
              <Pill tone={fresh.length > 0 ? "green" : "neutral"}>{fresh.length} new</Pill>
            </div>
            {bookings.map((b) => (
              <div key={b.id} className="flex flex-col gap-[10px] border-t border-line px-[18px] py-[14px]">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold">{b.patient_name}</div>
                  <div className="font-mono text-xs text-ink-2">{b.via.startsWith("Text") ? "via text" : "via call"}</div>
                </div>
                <div className="text-[13px]">
                  {fmtDateTime(b.start)} <span className="text-ink-2">· {nameOf(b.provider_id)}</span>
                </div>
                {b.review_state === "new" && open?.id !== b.id ? (
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => keep(b.id)} className="h-7 rounded-[7px] border border-green bg-green px-[10px] text-xs font-semibold text-white hover:bg-green-dk">
                      Looks good
                    </button>
                    <button type="button" onClick={() => setOpen({ id: b.id, mode: "reschedule" })} className={small}>
                      Reschedule
                    </button>
                    <button type="button" onClick={() => setOpen({ id: b.id, mode: "reassign" })} className={small}>
                      Reassign
                    </button>
                  </div>
                ) : null}
                {open?.id === b.id ? (
                  <div className="flex flex-wrap gap-1.5">
                    {open.mode === "reschedule"
                      ? b.alt_slots.map((s) => (
                          <button key={s.slot_id} type="button" onClick={() => reschedule(b.id, s.slot_id)} className={small}>
                            {fmtDateTime(s.start).replace(" · ", " ")}
                          </button>
                        ))
                      : b.reassign_options
                          .filter((id) => id !== b.provider_id)
                          .map((id) => (
                            <button key={id} type="button" onClick={() => reassign(b.id, id)} className={small}>
                              {nameOf(id)}
                            </button>
                          ))}
                    <button type="button" onClick={() => setOpen(null)} className="h-7 px-2 text-xs text-ink-2 hover:text-ink">
                      Cancel
                    </button>
                  </div>
                ) : null}
                {b.review_state === "kept" ? <div className="text-xs font-medium text-green-dk">Reviewed</div> : null}
              </div>
            ))}
            <p className="border-t border-line px-[18px] py-3 text-xs leading-normal text-ink-2">
              Bookings are firm when made. Doing nothing keeps them. Rescheduling or reassigning texts the patient.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
