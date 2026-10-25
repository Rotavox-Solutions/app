import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <div className="mb-8 text-lg font-semibold tracking-tight">Rotavox</div>
      {children}
    </div>
  );
}
