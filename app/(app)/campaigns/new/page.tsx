import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { Alert, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { campaignSenders, campaigns, messages, recipients, senders, suppressions } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { timezoneGroups } from "@/lib/timezones";
import { CampaignForm, type FollowUpInfo, type SenderOption } from "./campaign-form";

export const metadata: Metadata = { title: "New campaign" };

async function followUpInfo(id: string): Promise<FollowUpInfo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [original] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!original) return null;
  const [eligible] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(recipients, eq(recipients.id, messages.recipientId))
    .where(
      and(
        eq(messages.campaignId, id),
        eq(messages.status, "sent"),
        eq(recipients.status, "active"),
        sql`not exists (select 1 from ${suppressions} s where s.email = ${recipients.email})`,
      ),
    );
  const mailboxes = await db
    .select({ email: senders.email })
    .from(campaignSenders)
    .innerJoin(senders, eq(senders.id, campaignSenders.senderId))
    .where(eq(campaignSenders.campaignId, id));
  return {
    id: original.id,
    name: original.name,
    subject: original.subject,
    eligible: eligible.n,
    mailboxes: mailboxes.map((m) => m.email),
    window: {
      windowStart: original.windowStart,
      windowEnd: original.windowEnd,
      timezone: original.timezone,
      weekdaysOnly: original.weekdaysOnly,
    },
    style: original.style,
    trackOpens: original.trackOpens,
    trackClicks: original.trackClicks,
  };
}

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ followUp?: string }> }) {
  const { followUp } = await searchParams;
  const [me, settings, senderRows, follow] = await Promise.all([
    requireSession(),
    getSettings(),
    db
      .select({
        id: senders.id,
        email: senders.email,
        displayName: senders.displayName,
        provider: senders.provider,
        status: senders.status,
        dailyLimit: senders.dailyLimit,
      })
      .from(senders)
      .orderBy(asc(senders.createdAt)),
    followUp ? followUpInfo(followUp) : Promise.resolve(null),
  ]);

  const options: SenderOption[] = senderRows;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Campaigns
      </Link>
      <PageHeader
        title={follow ? "Send a follow-up" : "New campaign"}
        description={
          follow
            ? `Replies in the same thread to people from “${follow.name}” who haven't answered yet.`
            : "Add recipients, pick the mailboxes to send from, and write your email."
        }
      />
      {followUp && !follow && <Alert tone="danger">The campaign to follow up was not found.</Alert>}
      {!follow && options.length === 0 ? (
        <Card>
          <EmptyState
            title="Add a mailbox first"
            description="Campaigns send through your own mailboxes. Connect at least one Hostinger or Gmail mailbox."
            action={<ButtonLink href="/mailboxes/new">Add mailbox</ButtonLink>}
          />
        </Card>
      ) : (
        <CampaignForm
          senders={options}
          followUp={follow}
          testEmail={settings.testEmail ?? me.email}
          defaults={{
            windowStart: settings.windowStart,
            windowEnd: settings.windowEnd,
            timezone: settings.timezone,
            weekdaysOnly: settings.weekdaysOnly,
          }}
          zones={timezoneGroups(follow?.window.timezone ?? settings.timezone)}
        />
      )}
    </div>
  );
}
