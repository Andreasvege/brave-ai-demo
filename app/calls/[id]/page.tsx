import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import type { Analysis } from "@/lib/analyze";
import { formatDuration, formatDate } from "@/lib/format";
import { Card, CardAccentHeader, CardContent, Kicker } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { OutcomeBadge, ProviderBadge, StatusBadge } from "@/components/call-badges";
import { CopyButton, EditableTitle, ReanalyzeButton } from "./actions";

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

  const analysis = call.analysis as Analysis | null;
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
        <EditableTitle
          callId={call.id}
          initialTitle={call.title ?? null}
          fallback={crm?.company || crm?.contact_name || "Samtale"}
        />
          <Badge size="lg" tone="green">V1 Score: {analysis?.transcriptionScoreV1}</Badge>
          <Badge size="lg" tone="green">V2 Score: {analysis?.transcriptionScoreV2}</Badge>
        {call.status === "DONE" && analysis ? (
          <OutcomeBadge outcome={analysis.outcome} />
        ) : (
          <StatusBadge status={call.status} />
        )}
        <ProviderBadge providerId={call.transcribeProvider} />
        {call.transcribeMode && (
          <Badge tone="neutral" size="lg">
            {call.transcribeMode === "live"
              ? "Live"
              : call.transcribeMode === "batch"
                ? "Batch"
                : "Filopplasting"}
          </Badge>
        )}
        <span className="ml-auto text-sm text-ink-faint">
          {formatDate(call.createdAt)} · {formatDuration(call.durationSec)} min
        </span>
      </div>

      {call.status === "FAILED" && (
        <Card className="mb-6 border-danger-soft bg-danger-soft px-5 py-4 text-sm text-danger">
          Pipeline feilet: {call.error}
        </Card>
      )}

      {!analysis && call.status !== "FAILED" && (
        <Card className="px-5 py-10 text-center text-sm text-ink-soft">
          Analysen er ikke klar ennå. Oppdater siden om litt.
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          {analysis && (
            <>
              <Card className="fade-up px-6 py-5">
                <Kicker>Oppsummering</Kicker>
                <p className="mt-2.5 text-[15px] leading-relaxed">{analysis.summary}</p>
                {analysis.inferred_prospect_context && (
                  <p className="mt-3 border-l-2 border-accent-border pl-3 text-sm leading-relaxed text-ink-soft">
                    <span className="font-medium text-ink">Utledet om motparten:</span>{" "}
                    {analysis.inferred_prospect_context}
                  </p>
                )}
                {analysis.next_steps.length > 0 && (
                  <>
                    <Kicker className="mt-5">Neste steg</Kicker>
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
              </Card>

              {analysis.sales_tips.length > 0 && (
                <Card className="fade-up px-6 py-5" style={{ animationDelay: "60ms" }}>
                  <Kicker>Salgstips</Kicker>
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
                </Card>
              )}

              {analysis.objections.length > 0 && (
                <Card className="fade-up px-6 py-5" style={{ animationDelay: "120ms" }}>
                  <Kicker>Innvendinger</Kicker>
                  <ul className="mt-3 flex flex-col gap-3">
                    {analysis.objections.map((o, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm leading-relaxed">
                        <Badge
                          tone={o.handled_well ? "green" : "amber"}
                          size="sm"
                          className="mt-0.5 shrink-0"
                        >
                          {o.handled_well ? "Godt håndtert" : "Kan forbedres"}
                        </Badge>
                        <span>
                          {o.objection}
                          {o.inferred && (
                            <span className="ml-1.5 text-xs text-ink-faint">(utledet)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}

          {call.transcript && (
            <details className="card fade-up group px-6 py-5" style={{ animationDelay: "180ms" }}>
              <summary className="flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
                <Kicker>Transkript (kun din side)</Kicker>
                <span className="text-xs text-ink-faint transition-transform group-open:rotate-180">▾</span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink-soft">
                {call.transcript}
              </p>
            </details>
          )}

          {analysis?.transcriptV2 && (
            <details className="card fade-up group px-6 py-5" style={{ animationDelay: "180ms" }}>
              <summary className="flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
                <Kicker>TranskriptV2 (kun din side)</Kicker>
                <span className="text-xs text-ink-faint transition-transform group-open:rotate-180">▾</span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink-soft">
                {analysis?.transcriptV2}
              </p>
            </details>
          )}

          {call.audioUrl && (
            <Card className="fade-up px-6 py-5" style={{ animationDelay: "220ms" }}>
              <Kicker>Lydopptak</Kicker>
              <audio controls src={`/api/calls/${call.id}/audio`} className="mt-3 w-full" />
              <a
                href={`/api/calls/${call.id}/audio`}
                download
                className={`mt-3 inline-block ${buttonVariants({ variant: "ghost", size: "sm" })}`}
              >
                Last ned lydfil ↓
              </a>
            </Card>
          )}

          {call.notes && (
            <Card className="fade-up px-6 py-5" style={{ animationDelay: "240ms" }}>
              <Kicker>Dine notater</Kicker>
              <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                {call.notes}
              </p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {crm && (
            <Card className="fade-up overflow-hidden" style={{ animationDelay: "90ms" }}>
              <CardAccentHeader>Forslag til CRM-oppdatering</CardAccentHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-ink-faint">Firma</dt>
                  <dd className="font-medium">{crm.company ?? "–"}</dd>
                  <dt className="text-ink-faint">Kontakt</dt>
                  <dd className="font-medium">{crm.contact_name ?? "–"}</dd>
                  <dt className="text-ink-faint">Kontakt-rolle</dt>
                  <dd className="font-medium">{crm.contact_role ?? "–"}</dd>
                  <dt className="text-ink-faint">Status</dt>
                  <dd className="font-medium">{crm.status}</dd>
                </dl>
                <p className="mt-4 rounded-lg bg-bg px-4 py-3 text-sm leading-relaxed text-ink-soft">
                  {crm.notes}
                </p>
                <div className="mt-4">
                  <CopyButton text={crmText} />
                </div>
              </CardContent>
            </Card>
          )}

          {meeting?.should_book && (
            <Card className="fade-up overflow-hidden" style={{ animationDelay: "150ms" }}>
              <CardAccentHeader>Forslag til møte</CardAccentHeader>
              <CardContent>
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
                  className={`mt-4 ${buttonVariants({ size: "sm" })}`}
                >
                  Åpne i Google Calendar ↗
                </a>
              </CardContent>
            </Card>
          )}

          <div className="fade-up" style={{ animationDelay: "210ms" }}>
            <ReanalyzeButton callId={call.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
