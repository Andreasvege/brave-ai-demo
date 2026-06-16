"use client";

import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallButton() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const captured = (window as Window & { __pwaInstallEvent?: BeforeInstallPromptEvent }).__pwaInstallEvent;
    if (captured) {
      setInstallEvent(captured);
      return;
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!installEvent) return null;

  return (
    <button
      onClick={async () => {
        await installEvent.prompt();
        const { outcome } = await installEvent.userChoice;
        if (outcome === "accepted") setInstallEvent(null);
      }}
      className={buttonVariants({ variant: "ghost", size: "sm" })}
    >
      Installer som app
    </button>
  );
}
