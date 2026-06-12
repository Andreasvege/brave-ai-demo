import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { auth, signOut } from "@/auth";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Brave CallAI",
  description: "Transkribering og AI-analyse av cold calls",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html
      lang="nb"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-10 bg-bg/85 backdrop-blur-sm">
          <div className="brand-stripe" />
          <div className="border-b border-border">
            <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
              <Link href="/" className="flex items-center gap-2">
                <Image
                  src="/BraveAiFull.png"
                  alt="Brave AI"
                  width={145}
                  height={32}
                  className="h-8 w-auto object-contain"
                />
              </Link>
              <nav className="flex items-center gap-2 text-sm">
                {session?.user && (
                  <>
                    <Link
                      href="/"
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                    >
                      Samtaler
                    </Link>
                    <Link
                      href="/record"
                      className={`ml-2 ${buttonVariants({ variant: "accent", size: "sm" })}`}
                    >
                      Nytt opptak
                    </Link>
                    <span className="ml-4 flex items-center gap-2 text-xs text-ink-soft">
                      {session.user.image && (
                        <Image
                          src={session.user.image}
                          alt={session.user.name ?? ""}
                          width={24}
                          height={24}
                          className="rounded-full"
                        />
                      )}
                      {session.user.name}
                    </span>
                    <form
                      action={async () => {
                        "use server";
                        await signOut({ redirectTo: "/login" });
                      }}
                    >
                      <button
                        type="submit"
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        Logg ut
                      </button>
                    </form>
                  </>
                )}
              </nav>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
          {children}
        </main>
        <footer className="border-t border-border py-6">
          <p className="mx-auto w-full max-w-5xl px-6 text-xs text-ink-faint">
            Brave CallAI · intern demo · kun konsulentens mikrofon tas opp
          </p>
        </footer>
      </body>
    </html>
  );
}
