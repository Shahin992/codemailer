import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import { Time } from "@/components/client";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { senders } from "@/lib/db/schema";
import { sentLast24h } from "@/lib/queries";
import { PROVIDER_PRESETS } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { warmupDay } from "@/lib/warmup/schedule";
import { warmupSummaries } from "@/lib/warmup/status";

export const metadata: Metadata = { title: "Mailboxes" };

export default async function MailboxesPage() {
  const me = await requireSession();
  const rows = await db
    .select({ sender: senders, sent24h: sentLast24h })
    .from(senders)
    .where(eq(senders.userId, me.id))
    .orderBy(asc(senders.createdAt));
  const capacity = rows
    .filter((r) => r.sender.status === "active" && r.sender.warmupRole !== "partner")
    .reduce((sum, r) => sum + r.sender.dailyLimit, 0);
  const settings = await getSettings(me.id);
  const warmup = rows.some((r) => r.sender.warmupEnabled) ? await warmupSummaries(me.id, settings.timezone) : new Map();

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
                {sender.warmupRole === "partner" ? (
                  <Badge tone="primary">{sender.warmupEnabled ? "Warm-up partner" : "Warm-up partner (off)"}</Badge>
                ) : (
                  sender.warmupEnabled && (
                    <Badge tone="primary">
                      Warm-up day {sender.warmupStartedAt ? warmupDay(sender.warmupStartedAt, new Date(), settings.timezone, settings.weekdaysOnly) : 1}
                      {warmup.get(sender.id)?.sentToday ? ` · ${warmup.get(sender.id)!.sentToday} today` : ""}
                    </Badge>
                  )
                )}
                {/* Its own emails landing in spam; for a partner those are only its replies, so it isn't shown there. */}
                {sender.warmupRole !== "partner" && (warmup.get(sender.id)?.spam7d ?? 0) > 0 && (
                  <Badge tone="warning">
                    {warmup.get(sender.id)!.spam7d} of {warmup.get(sender.id)!.found7d} in spam
                  </Badge>
                )}
                {sender.status === "active" && sender.warmupRole !== "partner" && (
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
