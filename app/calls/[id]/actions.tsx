"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={copy}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
        copied
          ? "bg-green-soft text-green-ink"
          : "bg-ink text-white hover:opacity-85"
      }`}
    >
      {copied ? "Kopiert ✓" : "Kopier notat"}
    </button>
  );
}

export function DeleteButton({ callId }: { callId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function destroy() {
    setDeleting(true);
    await fetch(`/api/calls/${callId}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2">
        <button
          onClick={destroy}
          disabled={deleting}
          className="rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {deleting ? "Sletter…" : "Ja, slett permanent"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:text-ink"
        >
          Avbryt
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded-lg px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger-soft"
    >
      Slett samtale
    </button>
  );
}
