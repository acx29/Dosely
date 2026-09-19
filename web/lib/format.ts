const TZ = "America/New_York";

export function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso),
  );
}

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ }).format(d);
  return `${day} · ${fmtTime(iso)}`;
}

export function fmtShortDateTime(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TZ }).format(d);
  return `${day}, ${fmtTime(iso)}`;
}

export function usd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function num(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function pct(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const CLINIC_TZ = "America/New_York";

/** Decimal hour of day in the clinic's time zone, e.g. 9.5 for 9:30 AM. */
export function hourOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: CLINIC_TZ }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

/** YYYY-MM-DD in the clinic's time zone. */
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: CLINIC_TZ }).format(new Date(iso));
}

export function fmtDayTime(iso: string): string {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: CLINIC_TZ }).format(new Date(iso));
  return `${day} ${fmtTime(iso)}`;
}
