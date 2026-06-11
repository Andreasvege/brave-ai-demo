const OUTCOMES: Record<string, { label: string; cls: string }> = {
  booked_meeting: {
    label: "Møte booket",
    cls: "bg-green-soft text-green-ink",
  },
  callback: { label: "Ring tilbake", cls: "bg-amber-soft text-amber-ink" },
  not_interested: { label: "Ikke interessert", cls: "bg-danger-soft text-danger" },
  no_answer: { label: "Ikke svar", cls: "bg-bg text-ink-faint" },
  unclear: { label: "Uavklart", cls: "bg-bg text-ink-soft" },
};

const STATUSES: Record<string, { label: string; cls: string }> = {
  RECORDED: { label: "Mottatt", cls: "bg-bg text-ink-soft" },
  TRANSCRIBING: { label: "Transkriberer…", cls: "bg-accent-soft text-accent-ink" },
  ANALYZING: { label: "Analyserer…", cls: "bg-accent-soft text-accent-ink" },
  FAILED: { label: "Feilet", cls: "bg-danger-soft text-danger" },
};

const badgeBase =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

export function OutcomeBadge({ outcome }: { outcome: string | null }) {
  const o = (outcome && OUTCOMES[outcome]) || OUTCOMES.unclear;
  return <span className={`${badgeBase} ${o.cls}`}>{o.label}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUSES[status];
  if (!s) return null;
  return <span className={`${badgeBase} ${s.cls}`}>{s.label}</span>;
}

export function formatDuration(sec: number | null): string {
  if (sec == null) return "–";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
