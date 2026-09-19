import Link from "next/link";
import type { SponsoredPanelData } from "@/lib/types";

/**
 * An advertisement shown to a physician. It must never read as a clinical finding.
 * Rules:
 *  - last section on the card, visually separate from the chart
 *  - exact header and footer copy below
 *  - no score, no dose, no "match" / "recommended" / "good fit", no contraindication claims
 *  - render nothing at all when the API returns sponsored_panel: null
 */
export function SponsoredPanel({ panel }: { panel: SponsoredPanelData | null }) {
  if (!panel) return null;
  return (
    <section aria-label="Sponsored information" className="mt-2 flex flex-col gap-[18px] rounded-[10px] border border-dashed border-line-3 bg-subtle px-7 py-6">
      <div className="flex items-center justify-between gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">Sponsored information · Impiricus partner</div>
        <div className="text-xs text-ink-2">Not part of the patient chart</div>
      </div>

      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-10">
        <div className="flex flex-col gap-[10px]">
          <div className="text-xl font-semibold tracking-[-0.01em]">{panel.brand_name}</div>
          <div className="text-sm text-ink-2">
            {panel.manufacturer} · {panel.drug_class}
          </div>
          <p className="pt-1 text-sm leading-relaxed">{panel.ad_text}</p>
          <Link href={panel.label_url} className="self-start pt-1 text-sm font-medium text-green-dk underline decoration-green-bd underline-offset-[3px]">
            View full prescribing information
          </Link>
        </div>

        <div className="flex flex-col gap-[10px]">
          <div className="text-[13px] font-medium">Why you&apos;re seeing this</div>
          <ul className="flex flex-col border-b border-line-2">
            {panel.why_facts.map((f) => (
              <li key={f.label} className="flex justify-between gap-4 border-t border-line-2 py-[9px] text-sm">
                <span className="text-ink-2">{f.label}</span>
                <span className="text-right">{f.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-xs leading-normal text-ink-2">
        Shown based on labeled indication. Not a treatment recommendation. For physician review only.
      </p>
    </section>
  );
}
