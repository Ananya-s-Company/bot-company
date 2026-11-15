import type { Metadata } from "next";
import Link from "next/link";
import { currentSession } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = { title: "Command Center", robots: { index: false, follow: false } };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Navigation only for a full Owner session; the login and enrolment pages show none.
  const s = await currentSession();
  const signedIn = s?.kind === "full";
  return (
    <html lang="en">
      <body>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-gutter py-3">
            <Link href="/" className="font-semibold">
              Command Center
            </Link>
            {signedIn && (
              <nav className="flex items-center gap-4 text-sm text-subtle">
                <Link href="/" className="hover:text-ink">Home</Link>
                <Link href="/decisions" className="hover:text-ink">Decisions</Link>
                <Link href="/account" className="hover:text-ink">Security</Link>
                {/* AC6: a real POST navigation so the server destroys the session and clears caches. */}
                <form method="post" action="/logout">
                  <button type="submit" className="hover:text-ink">Sign out</button>
                </form>
              </nav>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-gutter py-section">{children}</main>
      </body>
    </html>
  );
}
