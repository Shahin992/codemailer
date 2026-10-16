import type { ReactNode } from "react";

export function AuthShell({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <main className="safe-top safe-bottom flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/brand/coldmailer-mark.svg" alt="" width={56} height={56} className="rounded-xl" />
          <h1 className="mt-4 text-xl font-semibold">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}
