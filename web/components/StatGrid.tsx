export interface Stat {
  label: string;
  value: string;
  sub?: string;
  subTone?: "muted" | "green";
  highlight?: boolean;
}

/** The joined boxes: one bordered container, hairline dividers between cells. */
export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div
      className="grid overflow-hidden rounded-[10px] border border-line bg-surface"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={`flex flex-col gap-[10px] px-[22px] py-5 ${i > 0 ? "border-l" : ""} ${
            s.highlight ? "border-green-bd bg-green-wash" : "border-line"
          }`}
        >
          <div className={`text-[13px] ${s.highlight ? "text-green-dk" : "text-ink-2"}`}>{s.label}</div>
          <div className={`font-mono text-[30px] font-medium tracking-[-0.03em] ${s.highlight ? "text-green-dk" : ""}`}>{s.value}</div>
          {s.sub ? (
            <div className={`text-xs ${s.subTone === "green" ? "font-medium text-green-dk" : "text-ink-2"}`}>{s.sub}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
