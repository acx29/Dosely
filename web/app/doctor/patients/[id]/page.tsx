import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Row } from "@/components/Card";
import { Pill, StatusPill } from "@/components/Pill";
import { SmsThread } from "@/components/SmsThread";
import { SponsoredPanel } from "@/components/SponsoredPanel";
import { Timeline } from "@/components/Timeline";
import { Transcript } from "@/components/Transcript";
import { getPatient } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtShortDateTime } from "@/lib/format";

function Field({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-ink-2">{label}</div>
      <div className={`text-[15px] font-medium ${tone ?? ""}`}>{children}</div>
    </div>
  );
}

function ContextRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-4 border-t border-line py-3 last:pb-0">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="text-sm leading-[1.55]">{children}</div>
    </div>
  );
}

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPatient(id);
  if (!p) notFound();

  const firstName = p.name.split(" ")[0];
  const overdueTone = p.follow_up.months_overdue >= 8 ? "text-red" : p.follow_up.months_overdue >= 6 ? "text-amber" : "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-[14px]">
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <Link href="/doctor/recall" className="text-green-dk hover:underline">
            Recall activity
          </Link>
          <span>/</span>
          <span className="text-ink">{p.name}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">{p.name}</h1>
            <span className="font-mono text-[13px] text-ink-2">{p.age}</span>
          </div>
          <div className="flex items-center gap-2">
            {p.appointment ? <Pill tone="green">Booked · {fmtDateTime(p.appointment.at).replace(" · ", ", ")}</Pill> : <StatusPill status={p.status} />}
            {p.action_needed.length > 0 ? <Pill tone="amber">{p.action_needed.length} action needed</Pill> : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start gap-5">
        <div className="flex flex-col gap-5">
          <Card title="Follow-up status">
            <div className="grid grid-cols-4 gap-4">
              <Field label="Last visit">{fmtDate(p.follow_up.last_visit)}</Field>
              <Field label="Recommended interval">{p.follow_up.interval_months} months</Field>
              <Field label="Was due">{fmtDate(p.follow_up.due)}</Field>
              <Field label="Overdue" tone={`font-mono ${overdueTone}`}>
                {p.follow_up.months_overdue} months
              </Field>
            </div>
          </Card>

          <Card title="Clinical context">
            <div className="-mt-3 flex flex-col">
              <ContextRow label="Active conditions">
                {p.clinical.conditions.map((c) => (
                  <div key={c.name}>
                    {c.name} {c.icd10 ? <span className="font-mono text-xs text-ink-2">{c.icd10}</span> : null}
                  </div>
                ))}
              </ContextRow>
              {p.clinical.medications.length > 0 ? (
                <ContextRow label="Current medications">
                  {p.clinical.medications.map((m) => (
                    <div key={m}>{m}</div>
                  ))}
                </ContextRow>
              ) : null}
              {p.clinical.last_lab ? (
                <ContextRow label="Last lab">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {p.clinical.last_lab.name} <span className="font-mono font-medium text-red">{p.clinical.last_lab.value}</span>
                    {p.clinical.last_lab.flag ? <Pill tone="amber">{p.clinical.last_lab.flag}</Pill> : null}
                    <span className="text-ink-2">· {fmtDate(p.clinical.last_lab.date)}</span>
                  </span>
                </ContextRow>
              ) : null}
              {p.clinical.note ? <ContextRow label="Last visit note">{p.clinical.note}</ContextRow> : null}
            </div>
          </Card>

          {p.transcript ? (
            <Card title="Agent transcript" aside={`${fmtShortDateTime(p.transcript.at)} · recorded with consent`}>
              <Transcript items={p.transcript.items} patientFirstName={firstName} />
              <p className="border-t border-line pt-4 text-xs leading-[1.55] text-ink-2">
                The agent handles scheduling only. No drug, diagnosis or sponsor information is spoken or texted to the patient. Clinical
                questions are escalated to staff.
              </p>
            </Card>
          ) : null}

          {p.sms_thread.length > 0 ? (
            <Card title="Text messages">
              <SmsThread messages={p.sms_thread} />
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          {p.appointment ? (
            <Card title="Appointment" variant="green">
              <div className="flex flex-col gap-1">
                <div className="text-xl font-semibold tracking-[-0.01em]">{fmtDateTime(p.appointment.at)}</div>
                <div className="text-sm text-ink-2">Follow-up with {p.appointment.with}</div>
              </div>
              <Link href="/doctor/schedule" className="self-start text-[13px] font-medium text-green-dk underline decoration-green-bd underline-offset-[3px]">
                Reschedule or reassign in Schedule
              </Link>
            </Card>
          ) : null}

          {p.action_needed.length > 0 ? (
            <Card title="Action needed" variant="amber">
              {p.action_needed.map((a) => (
                <div key={a} className="flex items-center justify-between gap-4">
                  <div className="text-sm">{a}</div>
                  <button type="button" className="h-[30px] whitespace-nowrap rounded-lg border border-amber-bd bg-surface px-3 text-[13px] font-medium text-amber">
                    Mark resolved
                  </button>
                </div>
              ))}
            </Card>
          ) : null}

          {p.call_summary ? (
            <Card title="Call summary">
              <div className="flex flex-col">
                <Row label="Channel">{p.call_summary.channel}</Row>
                <Row label="Identity verified">{p.call_summary.identity_verified}</Row>
                <Row label="Patient response">{p.call_summary.patient_response}</Row>
                <Row label="Call length">
                  <span className="font-mono">{p.call_summary.duration}</span>
                </Row>
              </div>
            </Card>
          ) : null}

          <Card title="Outreach timeline">
            <Timeline events={p.timeline} />
          </Card>
        </div>
      </div>

      {/* Always last. Renders nothing when the API returns null. */}
      <SponsoredPanel panel={p.sponsored_panel} />
    </div>
  );
}
