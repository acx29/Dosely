type Variant = "default" | "green" | "amber";

const VARIANTS: Record<Variant, { box: string; title: string }> = {
  default: { box: "border-line bg-surface", title: "text-ink-2" },
  green: { box: "border-green-bd bg-green-wash", title: "text-green-dk" },
  amber: { box: "border-amber-bd bg-amber-wash", title: "text-amber" },
};

export function Card({
  title,
  aside,
  variant = "default",
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  variant?: Variant;
  children: React.ReactNode;
}) {
  const v = VARIANTS[variant];
  return (
    <section className={`flex flex-col gap-4 rounded-[10px] border px-6 py-5 ${v.box}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={`text-[13px] font-medium ${v.title}`}>{title}</h2>
        {aside ? <div className="text-xs text-ink-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Label / value row with a hairline on top. Used inside cards. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-t border-line py-[10px] text-sm first:border-t-0 first:pt-0 last:pb-0">
      <span className="text-ink-2">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
