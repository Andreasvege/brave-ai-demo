"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function EditableTitle({
  callId,
  initialTitle,
  fallback,
}: {
  callId: string;
  initialTitle: string | null;
  fallback: string;
}) {
  const [title, setTitle] = useState(initialTitle ?? fallback);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function startEdit() {
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function save() {
    setEditing(false);
    const value = title.trim() || fallback;
    setTitle(value);
    await fetch(`/api/calls/${callId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: value === fallback ? null : value }),
    });
    router.refresh();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") { setTitle(initialTitle ?? fallback); setEditing(false); }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
        autoFocus
        className="text-2xl font-semibold tracking-tight bg-transparent border-b border-accent outline-none w-full max-w-md"
      />
    );
  }

  return (
    <h1
      onClick={startEdit}
      title="Klikk for å redigere navn"
      className="cursor-text text-2xl font-semibold tracking-tight hover:text-accent-ink transition-colors"
    >
      {title}
    </h1>
  );
}

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

export function ReanalyzeButton({ callId }: { callId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [extraContext, setExtraContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function reanalyze() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/calls/${callId}/reanalyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraContext }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Noe gikk galt");
      return;
    }
    router.refresh();
  }

  async function destroy() {
    setConfirming(false);
    await fetch(`/api/calls/${callId}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <textarea
        value={extraContext}
        onChange={(e) => setExtraContext(e.target.value)}
        placeholder="Tilleggsinformasjon til analysen — f.eks. bransje, firmastørrelse, tidligere kontakt…"
        rows={3}
        className="w-full resize-y rounded-xl border border-border bg-bg px-4 py-3 text-sm outline-none placeholder:text-ink-faint focus:border-accent-ink focus:bg-surface"
      />
      <div className="flex items-center justify-beginning gap-2">
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button onClick={reanalyze} disabled={loading} variant="ghost" size="sm">
          {loading ? "Analyserer…" : "↻ Kjør analyse på nytt"}
        </Button>
        {confirming ? (
          <>
            <Button onClick={destroy} variant="danger" size="sm">Ja, slett permanent</Button>
            <Button onClick={() => setConfirming(false)} variant="ghost" size="sm">Avbryt</Button>
          </>
        ) : (
          <Button onClick={() => setConfirming(true)} variant="dangerGhost" size="sm">
            Slett samtale
          </Button>
        )}
      </div>
    </div>
  );
}
