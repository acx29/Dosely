import { Card } from "@/components/Card";
import { StatGrid } from "@/components/StatGrid";
import { getDoctorMetrics } from "@/lib/api";
import { num, pct, usd } from "@/lib/format";

// This screen shows the practice's own visit revenue only.
// No drug names, manufacturer names or sponsor figures belong here.

export default async function PerformancePage() {
  const m = await getDoctorMetrics();
  const rate = m.visit_rate_usd;
  const realized = m.seen * rate;
  const projected = m.booked * rate;
  const incremental = Math.max(0, m.seen - m.baseline_expected_returns) * rate;

  const funnel = [
    { label: "Found", value: m.found, color: "bg-green-bd" },
    { label: "Contacted", value: m.contacted, color: "bg-[#8FC2AE]" },
    { label: "Booked", value: m.booked, color: "bg-[#3F9A7A]" },
    { label: "Seen", value: m.seen, color: "bg-green-dk" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Practice performance</h1>
          <p className="text-sm text-ink-2">Patient recall at Joel&apos;s Clinic</p>
        </div>
        <button type="button" className="h-9 rounded-lg border border-line-2 bg-surface px-3 text-sm">
          {m.period}
        </button>
      </div>

      <StatGrid
        stats={[
          { label: "Overdue found", value: num(m.found), sub: "nothing booked" },
          { label: "Contacted", value: num(m.contacted), sub: `${pct(m.contacted, m.found)} of found` },
          { label: "Booked", value: num(m.booked), sub: `${pct(m.booked, m.contacted)} book rate`, subTone: "green" },
          { label: "Seen", value: num(m.seen), sub: `${pct(m.seen, m.booked)} show rate`, subTone: "green" },
          { label: "Visit revenue recovered", value: usd(realized), sub: `${num(m.seen)} visits × ${usd(rate)}`, highlight: true },
        ]}
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-2">
        <span>
          Projected from bookings <span className="font-mono text-ink">{usd(projected)}</span>
        </span>
        <span>
          Incremental vs. no outreach <span className="font-mono text-ink">{usd(incremental)}</span>
        </span>
        <span>Based on a {usd(rate)} average visit</span>
      </div>

      <div className="grid grid-cols-2 items-start gap-5">
        <Card title="Recall funnel">
          <div className="flex flex-col gap-[14px]">
            {funnel.map((f) => (
              <div key={f.label} className="grid grid-cols-[84px_minmax(0,1fr)_44px] items-center gap-3">
                <div className="text-[13px]">{f.label}</div>
                <div className="h-[22px] rounded bg-fill">
                  <div className={`h-[22px] rounded ${f.color}`} style={{ width: `${(f.value / m.found) * 100}%` }} />
                </div>
                <div className="text-right font-mono text-[13px]">{num(f.value)}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Needs attention" aside={<span className="rounded bg-amber-bg px-1.5 py-px font-mono text-[11px] text-amber">{m.needs_attention.length}</span>}>
          <div className="flex flex-col">
            {m.needs_attention.map((n) => (
              <div key={n.patient} className="flex flex-col gap-0.5 border-t border-line py-[11px] first:border-t-0 first:pt-0 last:pb-0">
                <div className="text-sm font-medium">{n.patient}</div>
                <div className="text-[13px] text-ink-2">{n.reason}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
        <div className="grid h-10 grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] items-center gap-x-4 bg-subtle px-6 text-xs font-medium text-ink-2">
          <div>Condition</div>
          <div className="text-right">Overdue</div>
          <div className="text-right">Booked</div>
          <div className="text-right">Seen</div>
        </div>
        {m.by_condition.map((c) => (
          <div key={c.condition} className="grid h-11 grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] items-center gap-x-4 border-t border-line px-6 text-sm">
            <div>{c.condition}</div>
            <div className="text-right font-mono text-[13px]">{num(c.overdue)}</div>
            <div className="text-right font-mono text-[13px]">{num(c.booked)}</div>
            <div className="text-right font-mono text-[13px]">{num(c.seen)}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
