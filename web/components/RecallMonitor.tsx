"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { callPatient, runRecall, setHold } from "@/lib/api";
import { RECALL_BATCH_SIZE } from "@/lib/config";
import { fmtDate, fmtDayTime, initials } from "@/lib/format";
import type { OutreachStatus, OverdueRow } from "@/lib/types";
import { Pill, StatusPill } from "./Pill";

/**
 * Recall runs on its own. This screen is a monitor, not an approval queue.
 * The controls are the demo trigger (Run recall now), Call on a Queued row, which contacts that one
 * patient right away instead of waiting for the next run, and the brake (Hold / Release).
 */

const AVATARS = ["bg-green-bg text-green-dk", "bg-blue-bg text-blue", "bg-amber-bg text-amber", "bg-fill text-ink-3", "bg-red-bg text-red"];
const COLS = "grid grid-cols-[250px_minmax(0,1fr)_120px_90px_140px_150px] items-center gap-x-4 px-5";

type Filter = "contacted" | "queued" | "progress" | "booked" | "attention" | "hold";
const IN_PROGRESS: OutreachStatus[] = ["calling", "text_sent"];
const CONTACTED: OutreachStatus[] = ["calling", "text_sent", "booked", "needs_attention"];

// The screen opens on "Contacted": patients the agent has actually reached out to. Patients still
// waiting their turn are behind the "Queued" chip, shown a page at a time, because that list is
// the whole backlog (thousands of rows) and nobody needs to read it to follow what the agent is doing.
const FILTERS: { id: Filter; label: string; test: (r: OverdueRow) => boolean }[] = [
  { id: "contacted", label: "Contacted", test: (r) => CONTACTED.includes(r.status) },
  { id: "progress", label: "In progress", test: (r) => IN_PROGRESS.includes(r.status) },
  { id: "booked", label: "Booked", test: (r) => r.status === "booked" },
  { id: "attention", label: "Needs attention", test: (r) => r.status === "needs_attention" },
  { id: "hold", label: "On hold", test: (r) => r.status === "on_hold" },
  { id: "queued", label: "Queued", test: (r) => r.status === "queued" },
];
const PAGE_SIZE = 50;

// After a click on Call the row shows Calling at once. The server agrees within a second for a real
// call, and within about a minute for a simulated one, whose first event is stamped a little ahead of
// now. Until then the server still reports Queued, so the click is remembered here for this long.
const CALL_PENDING_MS = 90_000;

function overdueTone(months: number): string {
  if (months >= 8) return "text-red";
  if (months >= 6) return "text-amber";
  return "text-ink";
}

export function RecallMonitor({ initialRows }: { initialRows: OverdueRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>("contacted");
  const [shown, setShown] = useState(PAGE_SIZE); // how many rows of the current group are rendered
  const [running, setRunning] = useState(false);

  // The page re-fetches on a timer (see AutoRefresh). When a new set of rows arrives, take it.
  // Comparing against the previous prop during render is React's pattern for this.
  const [seenRows, setSeenRows] = useState(initialRows);
  if (initialRows !== seenRows) {
    setSeenRows(initialRows);
    setRows(initialRows);
  }

  const [pendingCalls, setPendingCalls] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  // What the table shows: the server's rows, with Calling in place of Queued for rows just clicked.
  const shownRows = useMemo(
    () => rows.map((r) => (r.status === "queued" && pendingCalls.has(r.id) ? { ...r, status: "calling" as const } : r)),
    [rows, pendingCalls],
  );

  const count = useCallback((id: Filter) => shownRows.filter(FILTERS.find((f) => f.id === id)!.test).length, [shownRows]);
  const matching = useMemo(() => shownRows.filter(FILTERS.find((f) => f.id === filter)!.test), [shownRows, filter]);
  const visible = matching.slice(0, shown);

  function pick(id: Filter) {
    setFilter(id);
    setShown(PAGE_SIZE);
  }

  async function runNow() {
    setRunning(true);
    // A run contacts one batch, not everyone queued, so nothing is flipped here.
    // The real statuses come back from the server on the refresh.
    try {
      await runRecall();
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setRunning(false);
    }
  }

  async function callNow(r: OverdueRow) {
    const forget = () =>
      setPendingCalls((prev) => {
        const next = new Set(prev);
        next.delete(r.id);
        return next;
      });
    setNotice(null);
    setPendingCalls((prev) => new Set(prev).add(r.id));
    try {
      const result = await callPatient(r.id);
      setTimeout(forget, CALL_PENDING_MS);
      if (result.mode === "live") setNotice({ tone: "info", text: `Calling ${r.name} now.` });
    } catch (err) {
      // The server refused (on hold, already contacted, ...) or the call could not be placed.
      forget();
      setNotice({ tone: "error", text: `${r.name} was not called. ${err instanceof Error ? err.message : String(err)}` });
    }
    router.refresh();
  }

  async function toggleHold(r: OverdueRow) {
    const held = r.status !== "on_hold";
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: held ? "on_hold" : "queued" } : x)));
    try {
      await setHold(r.id, held);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Recall activity</h1>
          <p className="text-sm text-ink-2">The agent contacts overdue patients on its own and books straight into the schedule.</p>
        </div>
        <div className="flex items-center gap-[10px]">
          <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-green-bd bg-green-wash px-3 text-[13px] font-medium text-green-dk">
            <span className="pulse-dot h-2 w-2 rounded-full bg-green" />
            Recall is on · runs daily at 9:00 AM
          </span>
          <button
            type="button"
            onClick={runNow}
            disabled={running && count("queued") === 0}
            className="h-9 rounded-lg border border-ink bg-ink px-[14px] text-sm font-medium text-white hover:bg-ink-3 disabled:opacity-50"
          >
            {running ? "Recall running" : "Run recall now"}
          </button>
        </div>
      </div>

      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-2.5 text-[13px] ${
            notice.tone === "error" ? "border-line-2 bg-red-bg text-red" : "border-green-bd bg-green-wash text-green-dk"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-xs font-medium underline underline-offset-2">
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-4 overflow-hidden rounded-[10px] border border-line bg-surface">
        {[
          { label: "Overdue found", value: rows.length, cls: "", sub: "due date passed, consent on file" },
          // One run contacts a batch, not the whole queue, so the tile says how many go next.
          { label: "Waiting to be contacted", value: count("queued"), cls: "", sub: `next run contacts ${Math.min(RECALL_BATCH_SIZE, count("queued"))}` },
          { label: "Outreach in progress", value: count("progress"), cls: "text-blue", sub: "calling now, or text awaiting reply" },
        ].map((s, i) => (
          <div key={s.label} className={`flex flex-col gap-1.5 px-5 py-4 ${i > 0 ? "border-l border-line" : ""}`}>
            <div className="text-[12.5px] text-ink-2">{s.label}</div>
            <div className={`font-mono text-2xl font-medium tracking-[-0.03em] ${s.cls}`}>{s.value.toLocaleString("en-US")}</div>
            <div className="text-xs text-ink-2">{s.sub}</div>
          </div>
        ))}
        <div className="flex flex-col gap-1.5 border-l border-green-bd bg-green-wash px-5 py-4">
          <div className="text-[12.5px] text-green-dk">Booked</div>
          <div className="font-mono text-2xl font-medium tracking-[-0.03em] text-green-dk">{count("booked")}</div>
          <div className="text-xs text-green-dk">on the schedule</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => pick(f.id)}
            className={`h-[30px] rounded-full border px-3 text-[12.5px] font-medium ${
              filter === f.id ? "border-ink bg-ink text-white" : "border-line-2 bg-surface text-ink-3 hover:border-line-3"
            }`}
          >
            {f.label} · {count(f.id).toLocaleString("en-US")}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
        <div className={`${COLS} h-10 bg-subtle text-xs font-medium text-ink-2`}>
          <div>Patient</div>
          <div>Active conditions</div>
          <div>Last visit</div>
          <div>Overdue</div>
          <div>Outreach</div>
          <div />
        </div>
        {visible.length === 0 ? (
          <div className="border-t border-line px-5 py-8 text-center text-sm text-ink-2">
            {filter === "contacted" ? "Nobody has been contacted yet. Run recall now to contact the first batch." : "Nobody in this group."}
          </div>
        ) : null}
        {visible.map((r) => {
          const i = rows.findIndex((x) => x.id === r.id);
          return (
            <div key={r.id} className={`${COLS} h-[52px] border-t border-line`}>
              <div className="flex min-w-0 items-center gap-[10px]">
                <span className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${AVATARS[i % AVATARS.length]}`}>
                  {initials(r.name)}
                </span>
                <Link href={`/doctor/patients/${r.id}`} className="truncate text-sm font-medium hover:text-green-dk hover:underline">
                  {r.name}
                </Link>
                <span className="font-mono text-xs text-ink-2">{r.age}</span>
                {r.has_sponsored_panel ? (
                  <span className="whitespace-nowrap rounded border border-dashed border-line-3 px-1.5 py-px text-[11px] text-ink-2">Sponsored info</span>
                ) : null}
              </div>
              {/* At most two chips, then "+N". overflow-hidden keeps a long name from spilling into the next column. */}
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden" title={r.conditions.join(", ")}>
                {r.conditions.slice(0, 2).map((c) => (
                  <span key={c} className="min-w-0 truncate whitespace-nowrap rounded bg-fill px-2 py-[3px] text-xs">
                    {c}
                  </span>
                ))}
                {r.conditions.length > 2 ? (
                  <span className="shrink-0 whitespace-nowrap rounded bg-fill px-2 py-[3px] text-xs text-ink-2">+{r.conditions.length - 2}</span>
                ) : null}
              </div>
              <div className="text-[13px] text-ink-2">{fmtDate(r.last_visit)}</div>
              <div className={`text-[13px] font-semibold ${overdueTone(r.months_overdue)}`}>{r.months_overdue} mo</div>
              <div>
                {/* Picked by the run that is playing out now, call not placed yet. Still in the Queued group,
                    but labelled so it is clear the agent already has this patient. */}
                {r.status === "queued" && r.in_current_run ? <Pill tone="blue">Up next</Pill> : <StatusPill status={r.status} />}
              </div>
              <div className="flex items-center justify-end gap-1.5">
                {r.status === "booked" && r.booked_for ? <span className="text-[13px] font-medium text-green-dk">{fmtDayTime(r.booked_for)}</span> : null}
                {/* Only Queued rows nobody has picked can be called. An "Up next" row already has a contact
                    record from the current run, and the server refuses a second one. */}
                {r.status === "queued" && !r.in_current_run ? (
                  <button
                    type="button"
                    onClick={() => callNow(r)}
                    className="h-7 rounded-[7px] border border-ink bg-ink px-[10px] text-xs font-medium text-white hover:bg-ink-3"
                  >
                    Call
                  </button>
                ) : null}
                {r.status === "queued" || r.status === "on_hold" ? (
                  <button
                    type="button"
                    onClick={() => toggleHold(r)}
                    className="h-7 rounded-[7px] border border-line-2 bg-surface px-[10px] text-xs font-medium text-ink-3 hover:bg-subtle"
                  >
                    {r.status === "on_hold" ? "Release" : "Hold"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {matching.length > visible.length ? (
          <div className="flex items-center justify-between gap-4 border-t border-line bg-subtle px-5 py-3 text-[13px] text-ink-2">
            <span>
              Showing {visible.length.toLocaleString("en-US")} of {matching.length.toLocaleString("en-US")}, most overdue first.
            </span>
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE_SIZE)}
              className="h-[30px] rounded-lg border border-line-2 bg-surface px-3 text-[12.5px] font-medium text-ink hover:bg-fill"
            >
              Show {Math.min(PAGE_SIZE, matching.length - visible.length)} more
            </button>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-ink-2">
        Every overdue patient with consent on file is contacted, {RECALL_BATCH_SIZE} per run, most overdue first. Call contacts one queued patient right
        away. Hold takes someone out of the next run. Do-not-contact flags are always respected.
      </p>
    </div>
  );
}
