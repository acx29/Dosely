import Link from "next/link";
import type { SponsoredMatch } from "@/lib/types";
import { ExplainMore } from "./ExplainMore";

/**
 * The output of the RAG pipeline for one patient: the 5 partner drugs nearest to the patient's
 * diagnoses, medications and visit notes, in the order the vector search returned them.
 * Each row shows the similarity score and Gemini's explanation of why the record surfaced.
 * Renders nothing when the pipeline has not produced matches for this patient.
 */
export function SponsoredMatches({ patientId, matches }: { patientId: string; matches: SponsoredMatch[] }) {
  if (matches.length === 0) return null;

  // Scores sit in a narrow band (for example 0.83 to 0.86), so the bar is scaled between the
  // lowest and highest score in this list. The number beside it is always the raw score.
  const scores = matches.map((m) => m.similarity);
  const low = Math.min(...scores);
  const span = Math.max(...scores) - low;

  return (
    <section aria-label="Sponsored pharmaceutical matches" className="mt-2 flex flex-col gap-4 rounded-[10px] border border-dashed border-line-3 bg-subtle px-7 py-6">
      <div className="flex items-center justify-between gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">Sponsored pharmaceutical matches · Impiricus partners</div>
        <div className="text-xs text-ink-2">Not part of the patient chart</div>
      </div>

      <div className="flex flex-col">
        {matches.map((m) => {
          const width = span > 0 ? 25 + ((m.similarity - low) / span) * 75 : 100;
          return (
            <div key={m.drug_id} className="grid grid-cols-[28px_minmax(0,1fr)_150px] gap-x-4 border-t border-line-2 py-4 first:border-t-0 first:pt-0 last:pb-0">
              <div className="pt-0.5 font-mono text-sm text-ink-2">{m.rank}</div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[15px] font-semibold tracking-[-0.01em]">{m.brand_name}</span>
                  {m.generic_name ? <span className="text-[13px] text-ink-2">({m.generic_name})</span> : null}
                  <span className="text-[13px] text-ink-2">· {m.company_name}</span>
                </div>
                <div className="text-[13px] text-ink-2">
                  {m.drug_class} · {m.therapeutic_area}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-xs text-ink-2">Indicated for</span>
                  {m.indications.map((i) => (
                    <span key={i} className="whitespace-nowrap rounded bg-fill px-2 py-[3px] text-xs">
                      {i}
                    </span>
                  ))}
                </div>
                {/* Saved Gemini text if there is one, otherwise the "Explain more" button. */}
                <ExplainMore patientId={patientId} drugId={m.drug_id} saved={m.why_surfaced} />
                <Link href={m.label_url} className="self-start pt-0.5 text-[13px] font-medium text-green-dk underline decoration-green-bd underline-offset-[3px]">
                  View full prescribing information
                </Link>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink-2">Similarity</span>
                  <span className="font-mono text-[13px] font-medium">{m.similarity.toFixed(4)}</span>
                </div>
                <div className="h-1.5 rounded bg-fill">
                  <div className="h-1.5 rounded bg-green" style={{ width: `${width}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs leading-normal text-ink-2">
        Ranked by vector similarity between this patient&apos;s diagnoses, medications and visit notes and each partner drug record. &quot;Explain
        more&quot; asks Gemini to describe that overlap. Not a treatment recommendation. For physician review only.
      </p>
    </section>
  );
}
