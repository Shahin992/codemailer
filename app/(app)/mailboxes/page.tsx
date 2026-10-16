import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { Time } from "@/components/client";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { senders } from "@/lib/db/schema";
import { sentLast24h } from "@/lib/queries";
import { PROVIDER_PRESETS } from "@/lib/providers";

export const metadata: Metadata = { title: "Mailboxes" };

export default async function MailboxesPage() {
  const rows = await db
    .select({ sender: senders, sent24h: sentLast24h })
    .from(senders)
    .orderBy(asc(senders.createdAt));
  const capacity = rows.filter((r) => r.sender.status === "active").reduce((sum, r) => sum + r.sender.dailyLimit, 0);

  return (
    <>
      <PageHeader
        title="Mailboxes"
        description={rows.length ? `${rows.length} connected · up to ${capacity} emails a day from active mailboxes` : "Connect the mailboxes you send from."}
        action={
          <ButtonLink href="/mailboxes/new">
            <Plus className="size-4" /> Add mailbox
          </ButtonLink>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No mailboxes yet"
            description="Add your Hostinger business mailboxes and any Gmail accounts. Each one sends up to its own daily limit."
            action={<ButtonLink href="/mailboxes/new">Add your first mailbox</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ sender, sent24h }) => (
            <Link
              key={sender.id}
              href={`/mailboxes/${sender.id}`}
              className="block rounded-xl border bg-card p-4 transition-colors hover:bg-neutral-soft"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{sender.email}</p>
                  <p className="truncate text-sm text-muted">{sender.displayName || "No sender name"}</p>
                </div>
                <StatusBadge status={sender.status} />
              </div>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted">Last 24 hours</span>
                <span className="tabular-nums font-medium">
                  {sent24h} / {sender.dailyLimit}
                </span>
              </div>
              <div className="mt-1.5">
                <Progress value={sent24h} max={sender.dailyLimit} tone={sent24h >= sender.dailyLimit ? "warning" : "primary"} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge>{PROVIDER_PRESETS[sender.provider].label}</Badge>
                {!sender.readInbox && <Badge tone="warning">send-only</Badge>}
                {sender.status === "active" && (
                  <span>
                    Next turn <Time value={sender.nextSendAt} mode="relative" />
                  </span>
                )}
              </div>
              {sender.lastError && <p className="mt-3 line-clamp-2 text-xs text-danger">{sender.lastError}</p>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
