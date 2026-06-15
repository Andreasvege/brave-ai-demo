"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDuration, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OutcomeBadge, StatusBadge } from "@/components/call-badges";
import { ChevronRightIcon } from "@/components/icons";
import type { Analysis } from "@/lib/analyze";
import type { Call } from "@prisma/client";

export function CallList({ calls }: { calls: Call[] }) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function exitSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setConfirming(false);
  }

  function toggle(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setConfirming(false);
  }

  async function deleteSelected() {
    setDeleting(true);
    await Promise.all(
      [...selected].map((id) => fetch(`/api/calls/${id}`, { method: "DELETE" }))
    );
    setSelected(new Set());
    setConfirming(false);
    setDeleting(false);
    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        {!selecting ? (
          <Button variant="primary" size="sm" onClick={() => setSelecting(true)}>
            Marker samtaler
          </Button>
        ) : confirming ? (
          <>
            <span className="text-sm text-ink-soft">
              Sletter {selected.size} {selected.size === 1 ? "samtale" : "samtaler"} permanent.
            </span>
            <Button variant="danger" size="sm" disabled={deleting} onClick={deleteSelected}>
              {deleting ? "Sletter…" : "Bekreft"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Avbryt
            </Button>
          </>
        ) : (
          <>
            {selected.size > 0 && (
              <>
                <span className="text-sm text-ink-soft">{selected.size} valgt</span>
                <Button variant="dangerGhost" size="sm" onClick={() => setConfirming(true)}>
                  Slett valgte
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={exitSelecting}>
              Ferdig
            </Button>
          </>
        )}
      </div>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {calls.map((call, i) => {
            const analysis = call.analysis as Analysis | null;
            const isSelected = selected.has(call.id);

            return (
              <li
                key={call.id}
                className={`fade-up flex items-center transition-colors ${isSelected ? "bg-accent-soft/40" : "hover:bg-bg"}`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {selecting && (
                  <label
                    className="flex h-full cursor-pointer items-center px-4 py-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => toggle(call.id, e)}
                      className="h-4 w-4 rounded border-border accent-accent"
                    />
                  </label>
                )}
                <Link
                  href={`/calls/${call.id}`}
                  className="flex flex-1 min-w-0 items-center gap-4 py-4 pr-5 pl-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {call.title ||
                        analysis?.suggested_crm_update?.company ||
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
    </>
  );
}
