import { Badge, type BadgeProps } from "@/components/ui/badge";

const OUTCOMES: Record<string, { label: string; tone: BadgeProps["tone"] }> = {
  booked_meeting: { label: "Møte booket", tone: "green" },
  callback: { label: "Ring tilbake", tone: "green" },
  not_interested: { label: "Ikke interessert", tone: "faint" },
  no_answer: { label: "Ikke svar", tone: "faint" },
  unclear: { label: "Uavklart", tone: "amber" },
};

const STATUSES: Record<string, { label: string; tone: BadgeProps["tone"] }> = {
  RECORDED: { label: "Mottatt", tone: "neutral" },
  TRANSCRIBING: { label: "Transkriberer…", tone: "accent" },
  ANALYZING: { label: "Analyserer…", tone: "accent" },
  FAILED: { label: "Feilet", tone: "danger" },
};

export function OutcomeBadge({ outcome }: { outcome: string | null }) {
  const o = (outcome && OUTCOMES[outcome]) || OUTCOMES.unclear;
  return <Badge tone={o.tone}>{o.label}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUSES[status];
  if (!s) return null;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
