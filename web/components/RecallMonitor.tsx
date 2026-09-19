"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { runRecall, setHold } from "@/lib/api";
import { fmtDate, fmtDayTime, initials } from "@/lib/format";
import type { OutreachStatus, OverdueRow } from "@/lib/types";
import { StatusPill } from "./Pill";

/**
 * Recall runs on its own. This screen is a monitor, not an approval queue.
 * The only controls are the demo trigger (Run recall now) and the brake (Hold / Release).
 */

const AVATARS = ["bg-green-bg text-green-dk", "bg-blue-bg text-blue", "bg-amber-bg text-amber", "bg-fill text-ink-3", "bg-red-bg text-red"];
const COLS = "grid grid-cols-[250px_minmax(0,1fr)_120px_90px_140px_150px] items-center gap-x-4 px-5";

type Filter = "all" | "queued" | "progress" | "booked" | "attention" | "hold";
const IN_PROGRESS: OutreachStatus[] = ["calling", "text_sent"];
const FILTERS: { id: Filter; label: string; test: (r: OverdueRow) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "queued", label: "Queued", test: (r) => r.status === "queued" },
  { id: "progress", label: "In progress", test: (r) => IN_PROGRESS.includes(r.status) },
  { id: "booked", label: "Booked", test: (r) => r.status === "booked" },
  { id: "attention", label: "Needs attention", test: (r) => r.status === "needs_attention" },
  { id: "hold", label: "On hold", test: (r) => r.status === "on_hold" },
];

function overdueTone(months: number): string {
  if (months >= 8) return "text-red";
  if (months >= 6) return "text-amber";
  return "text-ink";
}

export function RecallMonitor({ initialRows }: { initialRows: OverdueRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>("all");
  const [running, setRunning] = useState(false);

  const count = useCallback((id: Filter) => rows.filter(FILTERS.find((f) => f.id === id)!.test).length, [rows]);
  const visible = useMemo(() => rows.filter(FILTERS.find((f) => f.id === filter)!.test), [rows, filter]);

  async function runNow() {
    setRunning(true);
    // Optimistic: everyone queued starts getting called. Live status then comes from the API.
    setRows((prev) => prev.map((r) => (r.status === "queued" ? { ...r, status: "calling" } : r)));
    try {
      await runRecall();
    } catch (err) {
      console.error(err);
    }
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

      <div className="grid grid-cols-4 overflow-hidden rounded-[10px] border border-line bg-surface">
        {[
          { label: "Overdue, nothing booked", value: rows.length, cls: "" },
          { label: "Queued for next run", value: count("queued"), cls: "" },
          { label: "Outreach in progress", value: count("progress"), cls: "text-blue" },
        ].map((s, i) => (
          <div key={s.label} className={`flex flex-col gap-1.5 px-5 py-4 ${i > 0 ? "border-l border-line" : ""}`}>
            <div className="text-[12.5px] text-ink-2">{s.label}</div>
            <div className={`font-mono text-2xl font-medium tracking-[-0.03em] ${s.cls}`}>{s.value}</div>
          </div>
        ))}
        <div className="flex flex-col gap-1.5 border-l border-green-bd bg-green-wash px-5 py-4">
          <div className="text-[12.5px] text-green-dk">Booked</div>
          <div className="font-mono text-2xl font-medium tracking-[-0.03em] text-green-dk">{count("booked")}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`h-[30px] rounded-full border px-3 text-[12.5px] font-medium ${
              filter === f.id ? "border-ink bg-ink text-white" : "border-line-2 bg-surface text-ink-3 hover:border-line-3"
            }`}
          >
            {f.label} · {count(f.id)}
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
        {visible.length === 0 ? <div className="border-t border-line px-5 py-8 text-center text-sm text-ink-2">Nobody in this group.</div> : null}
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
              <div className="flex min-w-0 gap-1.5">
                {r.conditions.map((c) => (
                  <span key={c} className="whitespace-nowrap rounded bg-fill px-2 py-[3px] text-xs">
                    {c}
                  </span>
                ))}
              </div>
              <div className="text-[13px] text-ink-2">{fmtDate(r.last_visit)}</div>
              <div className={`text-[13px] font-semibold ${overdueTone(r.months_overdue)}`}>{r.months_overdue} mo</div>
              <div>
                <StatusPill status={r.status} />
              </div>
              <div className="flex items-center justify-end">
                {r.status === "booked" && r.booked_for ? <span className="text-[13px] font-medium text-green-dk">{fmtDayTime(r.booked_for)}</span> : null}
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
      </div>

      <p className="text-xs text-ink-2">
        Every overdue patient with consent on file is contacted. Hold takes someone out of the next run. Do-not-contact flags are always respected.
      </p>
    </div>
  );
}
