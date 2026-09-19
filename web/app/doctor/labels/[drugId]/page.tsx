import Link from "next/link";

// Stub for "View full prescribing information". In production this renders the FDA label.
export default async function LabelPage({ params }: { params: Promise<{ drugId: string }> }) {
  const { drugId } = await params;
  const name = drugId.charAt(0).toUpperCase() + drugId.slice(1);
  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      <Link href="/doctor/recall" className="text-[13px] text-green-dk hover:underline">
        ← Back to recall activity
      </Link>
      <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">Sponsored information · Impiricus partner</div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">{name}: full prescribing information</h1>
      <p className="text-sm leading-relaxed text-ink-2">
        {name} is a fictional product used for this demo. In production this page shows the FDA-approved label for the drug: indications and
        usage, dosage and administration, contraindications, warnings and precautions, adverse reactions and drug interactions.
      </p>
    </div>
  );
}
