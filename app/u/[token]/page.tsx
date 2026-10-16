import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { recipientForToken, unsubscribeByToken } from "@/lib/unsubscribe";

// Recipients see this page, so it carries no app name, icon or install manifest.
export const metadata: Metadata = {
  title: { absolute: "Unsubscribe" },
  description: null,
  applicationName: null,
  appleWebApp: null,
  manifest: null,
  icons: null,
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

async function confirm(token: string) {
  "use server";
  await unsubscribeByToken(token);
  redirect(`/u/${token}?done=1`);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="safe-top safe-bottom flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center">{children}</div>
    </main>
  );
}

function senderLabel(person: { senderName: string | null; senderEmail: string | null }): string | null {
  if (!person.senderEmail) return null;
  const domain = person.senderEmail.slice(person.senderEmail.indexOf("@") + 1);
  return person.senderName ? `${person.senderName} (${domain})` : domain;
}

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const person = await recipientForToken(token);

  if (!person) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">This link isn't valid</h1>
        <p className="mt-2 text-sm text-muted">It may have been copied incompletely. To stop these emails, reply to any of them with “unsubscribe”.</p>
      </Shell>
    );
  }
  const from = senderLabel(person);
  if (done || person.status === "unsubscribed") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">You're unsubscribed</h1>
        <p className="mt-2 text-sm text-muted">
          <span className="font-medium text-fg">{person.email}</span> won't get any more emails{from ? ` from ${from}` : ""}.
        </p>
      </Shell>
    );
  }
  return (
    <Shell>
      <h1 className="text-lg font-semibold">Unsubscribe?</h1>
      <p className="mt-2 text-sm text-muted">
        Stop all emails{from ? ` from ${from}` : ""} to <span className="font-medium text-fg break-all">{person.email}</span>.
      </p>
      <form action={confirm.bind(null, token)} className="mt-5">
        <button className="h-11 w-full rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover">Unsubscribe</button>
      </form>
      <p className="mt-3 text-xs text-muted">One click is enough. You won't be asked for anything else.</p>
    </Shell>
  );
}
