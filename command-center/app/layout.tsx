import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Command Center" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-gutter py-3">
            <Link href="/" className="font-semibold">
              Command Center
            </Link>
            <nav className="flex gap-4 text-sm text-subtle">
              <Link href="/" className="hover:text-ink">Home</Link>
              <Link href="/decisions" className="hover:text-ink">Decisions</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-gutter py-section">{children}</main>
      </body>
    </html>
  );
}
