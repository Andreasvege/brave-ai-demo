"use client";

import { providersByMode } from "@/lib/transcription/registry";
import type { ProviderId, TranscribeMode } from "@/lib/transcription/types";
import { cn } from "@/lib/utils";

export function ModelSelect({
  mode,
  value,
  onChange,
  disabled,
}: {
  mode: TranscribeMode;
  value: ProviderId;
  onChange: (id: ProviderId) => void;
  disabled?: boolean;
}) {
  const options = providersByMode(mode);
  return (
    <label className="mt-3 flex w-full max-w-xs flex-col gap-1">
      <span className="kicker">Modell</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ProviderId)}
        className={cn(
          "w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-ink",
          "outline-none transition-colors focus:border-accent-ink focus:bg-surface",
          "disabled:opacity-40"
        )}
      >
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
