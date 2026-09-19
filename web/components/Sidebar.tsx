"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { fmtTime, initials } from "@/lib/format";
import type { SidebarData, TimelineKind } from "@/lib/types";
import { DemoBadge } from "./DemoBadge";

const DOT: Record<TimelineKind, string> = {
  approval: "bg-green",
  call: "bg-blue",
  sms: "bg-blue",
  booking: "bg-green",
  problem: "bg-[#B7791F]",
};

function IconList() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
      <circle cx="2.5" cy="4" r="0.6" />
      <circle cx="2.5" cy="8" r="0.6" />
      <circle cx="2.5" cy="12" r="0.6" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M3 13V8M8 13V3M13 13V6" />
    </svg>
  );
}

const LABEL = "font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2";

export function Sidebar({
  overdueCount,
  doctor,
  clinic,
  data,
}: {
  overdueCount: number;
  doctor: string;
  clinic: string;
  data: SidebarData;
}) {
  const path = usePathname();
  const section = path.startsWith("/doctor/schedule") ? "schedule" : path.startsWith("/doctor/performance") ? "performance" : "recall";
  const item = (active: boolean) =>
    `flex h-9 items-center gap-[10px] rounded-lg px-[10px] text-sm ${
      active ? "bg-green-bg font-medium text-green-dk" : "text-ink-3 hover:bg-subtle"
    }`;
  const badge = (active: boolean, green = false) =>
    `rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ${active ? "bg-surface" : green ? "bg-green-bg" : "bg-fill"} ${green ? "text-green-dk" : "text-ink-3"}`;

  return (
    <aside className="sticky top-0 flex h-screen w-[264px] shrink-0 flex-col gap-[22px] overflow-y-auto border-r border-line bg-surface px-[14px] py-[18px]">
      <div className="flex items-center gap-[10px] px-1.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green text-[15px] font-bold text-white">D</div>
        <div className="text-[15.5px] font-semibold tracking-[-0.01em]">Dosely</div>
        <span className="ml-auto whitespace-nowrap rounded-full border border-line-2 px-[9px] py-[3px] text-[11px] font-medium text-ink-2">
          inside DocUpdate
        </span>
      </div>

      <nav className="flex flex-col gap-0.5">
        <div className={`${LABEL} px-[10px] pb-1.5`}>Workspace</div>
        <Link href="/doctor/performance" className={item(section === "performance")}>
          <IconChart />
          <span className="flex-1">Practice performance</span>
        </Link>
        <Link href="/doctor/schedule" className={item(section === "schedule")}>
          <IconCalendar />
          <span className="flex-1">Schedule</span>
          {data.new_bookings > 0 ? <span className={badge(section === "schedule", true)}>{data.new_bookings} new</span> : null}
        </Link>
        <Link href="/doctor/recall" className={item(section === "recall")}>
          <IconList />
          <span className="flex-1">Recall activity</span>
          <span className={badge(section === "recall")}>{overdueCount}</span>
        </Link>
      </nav>

      <section className="flex flex-col gap-[10px] rounded-[10px] border border-line bg-page px-[14px] py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <span className={`h-2 w-2 rounded-full ${data.agent.active ? "pulse-dot bg-green" : "bg-line-3"}`} />
            Scheduling agent
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${data.agent.active ? "bg-green-bg text-green-dk" : "bg-fill text-ink-3"}`}>
            {data.agent.active ? "Recall on" : "Paused"}
          </span>
        </div>
        <div className="flex flex-col text-[13px]">
          <div className="flex justify-between border-t border-line py-[7px]">
            <span className="text-ink-2">Calls in progress</span>
            <span className="font-mono font-medium">{data.agent.calls_in_progress}</span>
          </div>
          <div className="flex justify-between border-t border-line py-[7px]">
            <span className="text-ink-2">Texts awaiting reply</span>
            <span className="font-mono font-medium">{data.agent.texts_awaiting_reply}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-[7px]">
            <span className="text-ink-2">Booked today</span>
            <span className="font-mono font-medium text-green-dk">{data.agent.booked_today}</span>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 px-1.5">
        <div className={LABEL}>Recent activity</div>
        {data.activity.map((a) => (
          <div key={a.at + a.text} className="grid grid-cols-[8px_minmax(0,1fr)] items-start gap-[10px]">
            <span className={`mt-[5px] h-2 w-2 rounded-full ${DOT[a.kind]}`} />
            <div className="flex flex-col gap-px">
              <div className="text-[13px] leading-[1.4]">{a.text}</div>
              <div className="font-mono text-[11px] text-ink-2">{fmtTime(a.at)}</div>
            </div>
          </div>
        ))}
      </section>

      <div className="mt-auto flex flex-col gap-3 border-t border-line px-1.5 pt-[14px]">
        <div className="flex items-center gap-[10px]">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-green-bd bg-green-bg text-xs font-semibold text-green">
            {initials(doctor.replace("Dr. ", "A "))}
          </span>
          <div className="flex flex-col gap-px">
            <span className="text-[13.5px] font-medium">{doctor}</span>
            <span className="text-[12.5px] text-ink-2">{clinic}</span>
          </div>
        </div>
        <DemoBadge />
      </div>
    </aside>
  );
}
