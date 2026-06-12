"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button onClick={copy} variant={copied ? "success" : "primary"} size="sm">
      {copied ? "Kopiert ✓" : "Kopier notat"}
    </Button>
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
        <Button onClick={destroy} disabled={deleting} variant="danger" size="sm">
          {deleting ? "Sletter…" : "Ja, slett permanent"}
        </Button>
        <Button onClick={() => setConfirming(false)} variant="ghost" size="sm">
          Avbryt
        </Button>
      </span>
    );
  }

  return (
    <Button onClick={() => setConfirming(true)} variant="dangerGhost" size="sm">
      Slett samtale
    </Button>
  );
}
