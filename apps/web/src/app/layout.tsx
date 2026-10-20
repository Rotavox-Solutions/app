import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { stations } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationId } from "@/lib/station";
import { Sidebar } from "@/components/shell/Sidebar";
import "./globals.css";

// The shell reads the station from the DB, so nothing under it is statically prerendered.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Rotavox",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [station] = await db.select({ name: stations.name }).from(stations).where(eq(stations.id, stationId));

  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 antialiased">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row md:gap-10 md:px-6 md:py-8">
          <aside className="md:w-44 md:shrink-0">
            <Sidebar stationName={station?.name ?? "No station"} />
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
