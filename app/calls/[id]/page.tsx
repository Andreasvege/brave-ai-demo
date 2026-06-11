import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import type { Analysis } from "@/lib/analyze";
import { OutcomeBadge, StatusBadge, formatDuration, formatDate } from "../../ui/badges";
import { CopyButton, DeleteButton } from "./actions";

export const dynamic = "force-dynamic";

function calendarUrl(meeting: Analysis["suggested_meeting"]): string {
  // Forslag: i morgen kl. 10:00 lokal tid
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + (meeting.proposed_duration_minutes ?? 30) * 60_000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: meeting.proposed_title ?? "Oppfølgingsmøte",
    details: meeting.notes ?? "",
    dates: `${fmt(start)}/${fmt(end)}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export default async function CallDetailPage(props: PageProps<"/calls/[id]">) {
  const { id } = await props.params;
  const call = await prisma.call.findUnique({ where: { id } });
  if (!call) notFound();

  const analysis: Analysis | null = call.analysis ? JSON.parse(call.analysis) : null;
  const crm = analysis?.suggested_crm_update;
  const meeting = analysis?.suggested_meeting;

  const crmText = crm
    ? [
        crm.company && `Firma: ${crm.company}`,
        crm.contact_name && `Kontakt: ${crm.contact_name}`,
        `Status: ${crm.status}`,
        "",
        crm.notes,
      ]
        .filter((line): line is string => typeof line === "string")
        .join("\n")
    : "";

  return (
    <div className="fade-up">
      <Link href="/" className="text-sm text-ink-soft transition-colors hover:text-ink">
        ← Alle samtaler
      </Link>

      <div className="mt-4 mb-8 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {crm?.company || crm?.contact_name || "Samtale"}
        </h1>
        {call.status === "DONE" && analysis ? (
          <OutcomeBadge outcome={analysis.outcome} />
        ) : (
          <StatusBadge status={call.status} />
        )}
        <span className="ml-auto text-sm text-ink-faint">
          {formatDate(call.createdAt)} · {formatDuration(call.durationSec)} min
        </span>
      </div>

      {call.status === "FAILED" && (
        <div className="card mb-6 border-danger-soft bg-danger-soft px-5 py-4 text-sm text-danger">
          Pipeline feilet: {call.error}
        </div>
      )}

      {!analysis && call.status !== "FAILED" && (
        <div className="card px-5 py-10 text-center text-sm text-ink-soft">
          Analysen er ikke klar ennå. Oppdater siden om litt.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          {analysis && (
            <>
              <section className="card fade-up px-6 py-5">
                <h2 className="kicker">Oppsummering</h2>
                <p className="mt-2.5 text-[15px] leading-relaxed">{analysis.summary}</p>
                {analysis.inferred_prospect_context && (
                  <p className="mt-3 border-l-2 border-accent-border pl-3 text-sm leading-relaxed text-ink-soft">
                    <span className="font-medium text-ink">Utledet om motparten:</span>{" "}
                    {analysis.inferred_prospect_context}
                  </p>
                )}
                {analysis.next_steps.length > 0 && (
                  <>
                    <h3 className="kicker mt-5">Neste steg</h3>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {analysis.next_steps.map((s, i) => (
                        <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              {analysis.sales_tips.length > 0 && (
                <section className="card fade-up px-6 py-5" style={{ animationDelay: "60ms" }}>
                  <h2 className="kicker">Salgstips</h2>
                  <ul className="mt-3 flex flex-col gap-4">
                    {analysis.sales_tips.map((t, i) => (
                      <li key={i}>
                        <p className="text-sm font-medium leading-relaxed">{t.tip}</p>
                        {t.example_from_call && (
                          <p className="mt-1.5 rounded-lg bg-bg px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-ink-soft">
                            «{t.example_from_call}»
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {analysis.objections.length > 0 && (
                <section className="card fade-up px-6 py-5" style={{ animationDelay: "120ms" }}>
                  <h2 className="kicker">Innvendinger</h2>
                  <ul className="mt-3 flex flex-col gap-3">
                    {analysis.objections.map((o, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm leading-relaxed">
                        <span
                          className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            o.handled_well
                              ? "bg-green-soft text-green-ink"
                              : "bg-amber-soft text-amber-ink"
                          }`}
                        >
                          {o.handled_well ? "Godt håndtert" : "Kan forbedres"}
                        </span>
                        <span>
                          {o.objection}
                          {o.inferred && (
                            <span className="ml-1.5 text-xs text-ink-faint">(utledet)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {call.transcript && (
            <details className="card fade-up group px-6 py-5" style={{ animationDelay: "180ms" }}>
              <summary className="flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
                <h2 className="kicker">Transkript (kun din side)</h2>
                <span className="text-xs text-ink-faint transition-transform group-open:rotate-180">▾</span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink-soft">
                {call.transcript}
              </p>
            </details>
          )}

          {call.notes && (
            <section className="card fade-up px-6 py-5" style={{ animationDelay: "240ms" }}>
              <h2 className="kicker">Dine notater</h2>
              <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                {call.notes}
              </p>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {crm && (
            <section className="card fade-up overflow-hidden" style={{ animationDelay: "90ms" }}>
              <div className="border-b border-accent-border bg-accent-soft px-6 py-3">
                <h2 className="text-[13px] font-semibold text-accent-ink">Forslag til CRM-oppdatering</h2>
              </div>
              <div className="px-6 py-5">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-ink-faint">Firma</dt>
                  <dd className="font-medium">{crm.company ?? "–"}</dd>
                  <dt className="text-ink-faint">Kontakt</dt>
                  <dd className="font-medium">{crm.contact_name ?? "–"}</dd>
                  <dt className="text-ink-faint">Status</dt>
                  <dd className="font-medium">{crm.status}</dd>
                </dl>
                <p className="mt-4 rounded-lg bg-bg px-4 py-3 text-sm leading-relaxed text-ink-soft">
                  {crm.notes}
                </p>
                <div className="mt-4">
                  <CopyButton text={crmText} />
                </div>
              </div>
            </section>
          )}

          {meeting?.should_book && (
            <section className="card fade-up overflow-hidden" style={{ animationDelay: "150ms" }}>
              <div className="border-b border-accent-border bg-accent-soft px-6 py-3">
                <h2 className="text-[13px] font-semibold text-accent-ink">Forslag til møte</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm font-medium">{meeting.proposed_title ?? "Oppfølgingsmøte"}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {meeting.proposed_duration_minutes ?? 30} minutter
                </p>
                {meeting.notes && (
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">{meeting.notes}</p>
                )}
                <a
                  href={calendarUrl(meeting)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
                >
                  Åpne i Google Calendar ↗
                </a>
              </div>
            </section>
          )}

          <div className="fade-up flex justify-end" style={{ animationDelay: "210ms" }}>
            <DeleteButton callId={call.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
