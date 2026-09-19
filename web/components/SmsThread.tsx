import { fmtTime } from "@/lib/format";
import type { SmsMessage } from "@/lib/types";

export function SmsThread({ messages }: { messages: SmsMessage[] }) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => (
        <div key={m.at} className={`flex flex-col gap-1 ${m.direction === "in" ? "items-end" : "items-start"}`}>
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">
            {m.direction === "in" ? "Patient" : "Clinic"} · {fmtTime(m.at)}
          </div>
          <div
            className={`max-w-[460px] rounded-[10px] px-[14px] py-[10px] text-[13px] leading-normal ${
              m.direction === "in" ? "bg-green-bg text-green-dk" : "bg-subtle text-ink"
            }`}
          >
            {m.text}
          </div>
        </div>
      ))}
    </div>
  );
}
