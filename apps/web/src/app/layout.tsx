import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Rotavox — Log Cockpit",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 antialiased">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <nav className="mb-8 flex gap-4 text-sm text-neutral-400">
            <a href="/logs" className="hover:text-neutral-100">
              Logs
            </a>
            <a href="/reports/as-run" className="hover:text-neutral-100">
              As-Run Report
            </a>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
