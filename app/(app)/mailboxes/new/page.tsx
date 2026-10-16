import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { asc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { senders } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { MailboxForm } from "../mailbox-form";

export const metadata: Metadata = { title: "Add mailbox" };

export default async function NewMailboxPage() {
  const [me, settings, replyTargets] = await Promise.all([
    requireSession(),
    getSettings(),
    db.select({ id: senders.id, email: senders.email }).from(senders).where(eq(senders.readInbox, true)).orderBy(asc(senders.createdAt)),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/mailboxes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Mailboxes
      </Link>
      <PageHeader
        title="Add a mailbox"
        description="ColdMailer logs in to send and, where possible, to read replies. The password is stored encrypted and never shown again."
      />
      <MailboxForm testEmail={settings.testEmail ?? me.email} replyTargets={replyTargets} />
    </div>
  );
}
