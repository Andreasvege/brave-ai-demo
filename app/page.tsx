import Link from "next/link";
import { prisma } from "@/lib/db";
import { buttonVariants } from "@/components/ui/button";
import { MicIcon } from "@/components/icons";
import { CallList } from "./call-list";

export const dynamic = "force-dynamic";

export default async function CallListPage() {
  const calls = await prisma.call.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="fade-up">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight mb-4">Velkommen, Mr. Skibbedi-Rizzler</h1>
          <h2 className="text-2xl font-semibold tracking-tight">Samtaler</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {calls.length === 0
              ? "Ingen samtaler ennå"
              : `${calls.length} ${calls.length === 1 ? "samtale" : "samtaler"} fra Markus "The Goat" Johannessen analysert`}
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
        <CallList calls={calls} />
      )}
    </div>
  );
}
