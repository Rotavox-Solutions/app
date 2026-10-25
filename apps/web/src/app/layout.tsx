import type { ReactNode } from "react";
import "./globals.css";

// Every page reads the session, so nothing is statically prerendered.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Rotavox",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
