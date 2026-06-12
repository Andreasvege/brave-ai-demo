import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDuration, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { OutcomeBadge, StatusBadge } from "@/components/call-badges";
import { MicIcon, ChevronRightIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function CallListPage() {
  const calls = await prisma.call.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="fade-up">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Samtaler</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {calls.length === 0
              ? "Ingen samtaler ennå"
              : `${calls.length} ${calls.length === 1 ? "samtale" : "samtaler"} analysert`}
          </p>
        </div>
      </div>

      {calls.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 px-8 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
            <MicIcon />
          </div>
          <div>
            <p className="font-medium">Ta opp din første samtale</p>
            <p className="mt-1 text-sm text-ink-soft">
              Mikrofonopptak transkriberes og analyseres automatisk.
            </p>
          </div>
          <Link href="/record" className={`mt-2 ${buttonVariants()}`}>
            Start opptak
          </Link>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {calls.map((call, i) => {
              const analysis = call.analysis ? JSON.parse(call.analysis) : null;
              return (
                <li key={call.id} className="fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                  <Link
                    href={`/calls/${call.id}`}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {analysis?.suggested_crm_update?.company ||
                          analysis?.suggested_crm_update?.contact_name ||
                          "Ukjent motpart"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-faint">
                        {analysis?.summary || call.error || "Ingen analyse ennå"}
                      </p>
                    </div>
                    <span className="hidden font-mono text-xs text-ink-faint sm:block">
                      {formatDuration(call.durationSec)}
                    </span>
                    <span className="hidden text-xs text-ink-faint sm:block">
                      {formatDate(call.createdAt)}
                    </span>
                    {call.status === "DONE" ? (
                      <OutcomeBadge outcome={analysis?.outcome ?? null} />
                    ) : (
                      <StatusBadge status={call.status} />
                    )}
                    <ChevronRightIcon className="shrink-0 text-ink-faint" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
