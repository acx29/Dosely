"use client";

import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { fmtDateTime, fmtDayTime, initials } from "@/lib/format";
import type { Booking, Provider } from "@/lib/types";
import { Pill } from "./Pill";

/**
 * One agent-made booking at a time, as a card that tilts in 3D toward the cursor.
 * Looks good / Reschedule / Reassign. Tilt uses CSS variables set on the element,
 * so pointer moves never re-render React.
 */

type Mode = "main" | "reschedule" | "reassign";

function sevText(months: number): string {
  if (months >= 8) return "text-red";
  if (months >= 6) return "text-amber";
  return "text-ink";
}

function Face({ b, provider }: { b: Booking; provider: string }) {
  return (
    <div className="flex h-full flex-col gap-[18px] p-7" style={{ transformStyle: "preserve-3d" }}>
      <div className="flex items-center justify-between gap-4" style={{ transform: "translateZ(36px)" }}>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-green-bd bg-green-bg text-sm font-semibold text-green-dk">
            {initials(b.patient_name)}
          </span>
          <div className="flex flex-col">
            <div className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">{b.patient_name}</div>
            <div className="text-[13px] text-ink-2">
              {b.age} years old · {b.conditions.join(", ")}
            </div>
          </div>
        </div>
        <Pill tone="green">Booked by Dosely</Pill>
      </div>

      <div className="flex flex-col gap-1 rounded-[10px] border border-green-bd bg-green-wash px-[18px] py-4" style={{ transform: "translateZ(28px)" }}>
        <div className="text-xs text-green-dk">Appointment</div>
        <div className="text-2xl font-semibold tracking-[-0.02em]">{fmtDateTime(b.start)}</div>
        <div className="text-[13.5px] text-ink-3">Follow-up · 30 min · with {provider}</div>
      </div>

      <div className="grid grid-cols-3 overflow-hidden rounded-[10px] border border-line" style={{ transform: "translateZ(18px)" }}>
        <div className="flex flex-col gap-[3px] px-[14px] py-[11px]">
          <div className="text-xs text-ink-2">Was overdue</div>
          <div className={`font-mono text-[17px] font-medium ${sevText(b.months_overdue)}`}>{b.months_overdue} mo</div>
        </div>
        <div className="flex flex-col gap-[3px] border-l border-line px-[14px] py-[11px]">
          <div className="text-xs text-ink-2">Booked via</div>
          <div className="pt-0.5 text-sm font-medium">{b.via}</div>
        </div>
        <div className="flex flex-col gap-[3px] border-l border-line px-[14px] py-[11px]">
          <div className="text-xs text-ink-2">Patient told</div>
          <div className="pt-0.5 text-sm font-medium">Text confirmed</div>
        </div>
      </div>

      <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 text-sm" style={{ transform: "translateZ(12px)" }}>
        <span className="text-[13px] text-ink-2">From the call</span>
        <span className="leading-[1.5]">{b.note}</span>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-line pt-[14px] text-[13px]" style={{ transform: "translateZ(8px)" }}>
        <span className="text-ink-2">Doing nothing keeps this booking.</span>
        <Link href={`/doctor/patients/${b.patient_id}`} className="font-medium text-green-dk underline decoration-green-bd underline-offset-[3px]">
          Open full card
        </Link>
      </div>
    </div>
  );
}

export function BookingDeck({
  bookings,
  providers,
  onKeep,
  onReschedule,
  onReassign,
  onExit,
}: {
  bookings: Booking[];
  providers: Provider[];
  onKeep: (id: string) => void;
  onReschedule: (id: string, slotId: string) => void;
  onReassign: (id: string, providerId: string) => void;
  onExit: () => void;
}) {
  const deck = bookings.filter((b) => b.review_state === "new");
  const [total] = useState(deck.length); // deck size when the view opened
  const [leaving, setLeaving] = useState(false);
  const [mode, setMode] = useState<Mode>("main");
  const [lastMsg, setLastMsg] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const top = deck[0];
  const nameOf = useCallback((id: string) => providers.find((p) => p.id === id)?.name ?? id, [providers]);

  const resetTilt = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--glare", "0");
  }, []);

  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const px = Math.max(-0.6, Math.min(0.6, (e.clientX - r.left) / r.width - 0.5));
    const py = Math.max(-0.6, Math.min(0.6, (e.clientY - r.top) / r.height - 0.5));
    el.style.setProperty("--ry", `${px * 16}deg`);
    el.style.setProperty("--rx", `${-py * 12}deg`);
    el.style.setProperty("--gx", `${(px + 0.5) * 100}%`);
    el.style.setProperty("--gy", `${(py + 0.5) * 100}%`);
    el.style.setProperty("--glare", "1");
  }, []);

  function finish(msg: string, commit: () => void) {
    if (!top || leaving) return;
    setLeaving(true);
    window.setTimeout(() => {
      commit();
      setLastMsg(msg);
      setMode("main");
      setLeaving(false);
      resetTilt();
    }, 300);
  }

  function keep() {
    if (!top) return;
    const who = top.patient_name.split(" ")[0];
    finish(`kept ${who}'s booking`, () => onKeep(top.id));
  }

  // Always sees the latest deck without re-subscribing the listener.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "ArrowRight") keep();
    if (e.key === "Escape") setMode("main");
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!top) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-[10px] border border-line bg-surface px-8 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-bg text-green-dk">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 11.5l4 4 8-9" />
          </svg>
        </div>
        <div className="text-xl font-semibold tracking-[-0.01em]">All caught up</div>
        <p className="max-w-[440px] text-sm text-ink-2">{total > 0 ? `${total} bookings reviewed.` : "No new bookings to review."} New ones appear here as the agent makes them.</p>
        <button type="button" onClick={onExit} className="h-9 rounded-lg border border-line-2 bg-surface px-4 text-sm font-medium hover:bg-subtle">
          Back to calendar
        </button>
      </div>
    );
  }

  const first = top.patient_name.split(" ")[0];
  const opt = "h-10 rounded-[10px] border border-line-2 bg-surface px-[14px] text-[13.5px] font-medium hover:border-green hover:text-green-dk";

  return (
    <div className="flex flex-col items-center gap-7">
      <div className="relative h-[480px] w-full max-w-[560px]" style={{ perspective: 1200 }} onPointerMove={onMove} onPointerLeave={resetTilt}>
        {deck.slice(1, 3).map((b, i) => (
          <div
            key={b.id}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl border border-line bg-surface transition-transform duration-300"
            style={{ transform: `translateY(${(i + 1) * 16}px) scale(${1 - (i + 1) * 0.045})`, opacity: 1 - (i + 1) * 0.25, zIndex: 2 - i }}
          >
            <Face b={b} provider={nameOf(b.provider_id)} />
          </div>
        ))}

        <div
          ref={cardRef}
          key={top.id}
          className="absolute inset-0 rounded-2xl border border-line bg-surface shadow-[0_24px_48px_-24px_rgba(28,27,24,0.28)]"
          style={{
            transform: leaving ? "translateX(135%) rotate(14deg)" : "rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))",
            opacity: leaving ? 0 : 1,
            zIndex: 3,
            transformStyle: "preserve-3d",
            transition: leaving ? "transform 300ms ease-in, opacity 300ms ease-in" : "transform 140ms ease-out",
            willChange: "transform",
          }}
        >
          <Face b={top} provider={nameOf(top.provider_id)} />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-200"
            style={{
              opacity: "calc(var(--glare, 0) * 0.55)",
              background: "radial-gradient(circle at var(--gx, 50%) var(--gy, 50%), rgba(255,255,255,0.9), rgba(255,255,255,0) 55%)",
            }}
          />
        </div>
      </div>

      <div className="flex min-h-[96px] flex-col items-center gap-3">
        {mode === "main" ? (
          <div className="flex items-center gap-[10px]">
            <button type="button" onClick={() => setMode("reassign")} className="h-11 w-[140px] rounded-[10px] border border-line-2 bg-surface text-sm font-medium text-ink-3 hover:bg-subtle">
              Reassign
            </button>
            <button type="button" onClick={() => setMode("reschedule")} className="h-11 w-[140px] rounded-[10px] border border-line-2 bg-surface text-sm font-medium text-ink-3 hover:bg-subtle">
              Reschedule
            </button>
            <button type="button" onClick={keep} className="h-11 w-[190px] rounded-[10px] border border-green bg-green text-sm font-semibold text-white hover:bg-green-dk">
              Looks good
            </button>
          </div>
        ) : null}

        {mode === "reschedule" ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="pr-1 text-[13px] text-ink-2">Offer instead:</span>
            {top.alt_slots.map((s) => (
              <button
                key={s.slot_id}
                type="button"
                className={opt}
                onClick={() => finish(`texted ${first} the new time, ${fmtDayTime(s.start)}`, () => onReschedule(top.id, s.slot_id))}
              >
                {fmtDayTime(s.start)}
              </button>
            ))}
            <button type="button" onClick={() => setMode("main")} className="h-10 px-[10px] text-[13px] text-ink-2 hover:text-ink">
              Cancel
            </button>
          </div>
        ) : null}

        {mode === "reassign" ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="pr-1 text-[13px] text-ink-2">Same time, move to:</span>
            {top.reassign_options
              .filter((id) => id !== top.provider_id)
              .map((id) => (
                <button key={id} type="button" className={opt} onClick={() => finish(`moved ${first} to ${nameOf(id)} and texted them`, () => onReassign(top.id, id))}>
                  {nameOf(id)}
                </button>
              ))}
            <button type="button" onClick={() => setMode("main")} className="h-10 px-[10px] text-[13px] text-ink-2 hover:text-ink">
              Cancel
            </button>
          </div>
        ) : null}

        <div className="font-mono text-xs text-ink-2">
          {total - deck.length} of {total} reviewed{lastMsg ? ` · ${lastMsg}` : ""}
        </div>
      </div>
    </div>
  );
}
