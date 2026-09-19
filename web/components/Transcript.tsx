import type { TranscriptItem } from "@/lib/types";

export function Transcript({ items, patientFirstName }: { items: TranscriptItem[]; patientFirstName: string }) {
  return (
    <div className="flex flex-col gap-[13px]">
      {items.map((it, i) =>
        it.type === "tool" ? (
          <div key={i} className="pl-[46px]">
            <span
              className={`inline-block rounded-md border px-2 py-[3px] font-mono text-[11px] ${
                it.escalation ? "border-amber-bd bg-amber-bg text-amber" : "border-line bg-subtle text-ink-2"
              }`}
            >
              {it.text}
            </span>
          </div>
        ) : (
          <div key={i} className="flex gap-3">
            <span className="w-[34px] shrink-0 pt-[3px] font-mono text-[11px] text-ink-2">{it.t}</span>
            <div className="min-w-0 text-[13.5px] leading-[1.55]">
              <span className={`font-semibold ${it.speaker === "agent" ? "text-green" : ""}`}>
                {it.speaker === "agent" ? "Agent" : patientFirstName}
              </span>{" "}
              · {it.text}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
