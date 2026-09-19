import { DemoBadge } from "@/components/DemoBadge";
import { Pill, type Tone } from "@/components/Pill";
import { PillBottle } from "@/components/PillBottle";
import { StatGrid } from "@/components/StatGrid";
import { getImpiricusMetrics } from "@/lib/api";
import { num } from "@/lib/format";

// Sponsor-side view. Aggregates only: no patient names, rows, identifiers or drill-down.
// Deliberately has no prescriptions or starts column. Dosely does not track prescribing.

const AREA_TONE: Record<string, Tone> = {
  Diabetes: "amber",
  Hypertension: "red",
  Hyperlipidemia: "neutral",
  Respiratory: "blue",
  Endocrine: "green",
};

const COLS = "grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_repeat(4,96px)] items-center gap-x-3 px-6";

export default async function ImpiricusPage() {
  const m = await getImpiricusMetrics();
  const top = [...m.campaigns].sort((a, b) => b.panels_shown - a.panels_shown)[0];
  const dose = top.label_name.replace(top.brand_name, "").trim();

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-12">
        <div className="flex items-center gap-3">
          <div className="h-[22px] w-[22px] rounded-md bg-green" />
          <div className="text-[15px] font-semibold tracking-[-0.01em]">Impiricus</div>
          <span className="text-line-3">/</span>
          <div className="text-sm text-ink-2">Dosely partner analytics</div>
        </div>
        <div className="flex items-center gap-[10px]">
          <DemoBadge />
          <button type="button" className="h-8 rounded-lg border border-line-2 bg-surface px-3 text-[13px]">
            {m.period}
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1344px] flex-col gap-6 px-12 py-10">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Network overview</h1>
          <p className="text-sm text-ink-2">Aggregate activity across practices using patient recall</p>
        </div>

        <StatGrid
          stats={[
            { label: "Practices active", value: num(m.practices_active) },
            { label: "Weekly physician opens", value: num(m.weekly_physician_opens) },
            { label: "Patients recalled", value: num(m.patients_recalled) },
            { label: "Visits booked", value: num(m.visits_booked), highlight: true },
          ]}
        />

        <div className="grid grid-cols-[minmax(0,1fr)_380px] items-stretch gap-5">
          <section className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
            <div className="flex items-center justify-between px-6 py-[18px]">
              <h2 className="text-[13px] font-medium text-ink-2">Sponsored campaigns</h2>
              <div className="text-xs text-ink-2">Most recalled patients have no sponsored panel</div>
            </div>
            <div className={`${COLS} h-10 border-t border-line bg-subtle text-xs font-medium text-ink-2`}>
              <div>Drug</div>
              <div>Therapeutic area</div>
              <div className="text-right">Panels shown</div>
              <div className="text-right">Physicians</div>
              <div className="text-right">Label views</div>
              <div className="text-right">Booked</div>
            </div>
            {m.campaigns.map((c) => (
              <div key={c.drug_id} className={`${COLS} h-[60px] border-t border-line`}>
                <div className="flex flex-col gap-0.5">
                  <div className="text-sm font-medium">{c.brand_name}</div>
                  <div className="text-xs text-ink-2">{c.manufacturer}</div>
                </div>
                <div>
                  <Pill tone={AREA_TONE[c.therapeutic_area] ?? "neutral"}>{c.therapeutic_area}</Pill>
                </div>
                <div className="text-right font-mono text-[13px]">{num(c.panels_shown)}</div>
                <div className="text-right font-mono text-[13px]">{num(c.physicians_reached)}</div>
                <div className="text-right font-mono text-[13px]">{num(c.label_views)}</div>
                <div className="text-right font-mono text-[13px] font-medium text-green-dk">{num(c.booked)}</div>
              </div>
            ))}
          </section>

          <section className="flex flex-col items-center gap-[18px] rounded-[10px] border border-line bg-surface px-6 pb-6 pt-5">
            <h2 className="self-start text-[13px] font-medium text-ink-2">Top campaign this period</h2>
            <PillBottle name={top.brand_name} detail={dose ? `${dose} tablets` : undefined} />
            <div className="flex flex-col items-center gap-1">
              <div className="text-[17px] font-semibold tracking-[-0.01em]">{top.label_name}</div>
              <div className="text-[13px] text-ink-2">{top.manufacturer}</div>
            </div>
            <div className="grid grid-cols-3 self-stretch overflow-hidden rounded-lg border border-line">
              {[
                { v: top.panels_shown, l: "panels shown" },
                { v: top.label_views, l: "label views" },
                { v: top.booked, l: "booked", green: true },
              ].map((x, i) => (
                <div key={x.l} className={`flex flex-col items-center gap-0.5 py-3 ${i > 0 ? "border-l border-line" : ""}`}>
                  <div className={`font-mono text-base font-medium ${x.green ? "text-green-dk" : ""}`}>{num(x.v)}</div>
                  <div className="text-xs text-ink-2">{x.l}</div>
                </div>
              ))}
            </div>
            <p className="text-center text-xs leading-normal text-ink-2">Shown where the labeled indication matches a diagnosis on file.</p>
          </section>
        </div>

        <p className="text-xs text-ink-2">Aggregate data only. No patient-level information is shared with partners.</p>
      </main>
    </div>
  );
}
