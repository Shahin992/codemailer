// The warm-up conversations of one mailbox: a list like a mail app's, where the mailbox's own emails always
// read "You" (blue) and the other mailbox's read by its name, so it's clear who wrote what.
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Clock, Mail, ShieldAlert, ShieldCheck } from "lucide-react";
import { Time } from "@/components/client";
import { FilterChips, ListSearch, Pagination } from "@/components/pagination";
import { Card, EmptyState, cn } from "@/components/ui";
import type { Sender } from "@/lib/db/schema";
import { extractReplyText } from "@/lib/mail/inbound-parse";
import { clampPage, pageInfo, readPage } from "@/lib/pagination";
import { snippet } from "@/lib/push";
import { firstName } from "@/lib/warmup/content";
import { HISTORY_FILTERS, messagePreview, warmupHistoryStats, warmupThreads, type HistoryFilter, type ThreadSummary } from "@/lib/warmup/history";
import { Avatar, Pill } from "../parts";

export type ConversationSearch = { tab?: string; show?: string; q?: string; page?: string; size?: string };

/** What happened in the conversation, most important first. */
function ThreadState({ t }: { t: ThreadSummary }) {
  const icon = "size-3.5";
  return (
    <>
      {t.stillInSpam && <Pill tone="danger" icon={<ShieldAlert className={icon} />}>In spam</Pill>}
      {t.spam && !t.stillInSpam && <Pill tone="warning" icon={<ShieldCheck className={icon} />}>Spam · moved to inbox</Pill>}
      {t.failed && <Pill tone="danger">Failed</Pill>}
      {t.planned && <Pill tone="neutral" icon={<Clock className={icon} />}>Waiting to send</Pill>}
    </>
  );
}

/** One conversation in a list: the other mailbox, the subject, the latest email ("You: …" or "Mark: …"). */
export function ConversationRow({ t, mailboxId }: { t: ThreadSummary; mailboxId: string }) {
  const them = firstName(t.partnerName, t.partnerEmail) ?? t.partnerEmail;
  const preview = t.latestText ? snippet(messagePreview(t.latestText, extractReplyText), 160) : null;
  return (
    <Link
      href={`/warmup/${mailboxId}/${t.threadId}`}
      className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-neutral-soft md:px-5"
    >
      <Avatar name={t.partnerName} email={t.partnerEmail} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm">
            <span className="font-semibold">{t.partnerName || t.partnerEmail}</span>
            {t.partnerName && <span className="text-muted"> · {t.partnerEmail}</span>}
          </p>
          <span className="shrink-0 text-xs text-muted">
            <Time value={t.lastAt} mode="relative" />
          </span>
        </div>
        <p className={cn("truncate text-sm", t.subject ? "font-medium" : "text-muted italic")}>{t.subject ?? "Text is written when it's sent"}</p>
        {preview && (
          <p className="line-clamp-2 text-sm text-muted">
            {/* Whose email is the latest: yours in blue, theirs by name. */}
            <span className={cn("font-semibold", t.latestFromHere ? "text-primary" : "text-fg")}>{t.latestFromHere ? "You" : them}:</span> {preview}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium", t.startedHere ? "text-primary" : "text-muted")}>
            {t.startedHere ? <ArrowUpRight className="size-3.5" /> : <ArrowDownLeft className="size-3.5" />}
            {t.startedHere ? "You started it" : `${them} started it`}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Mail className="size-3.5" />
            {t.messages} {t.messages === 1 ? "email" : "emails"}
          </span>
          <ThreadState t={t} />
        </div>
      </div>
      <ChevronRight className="mt-2 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

/** The Conversations tab: search, filters, the list and paging. */
export async function ConversationsTab({ userId, mailbox, search }: { userId: string; mailbox: Sender; search: ConversationSearch }) {
  const isPartner = mailbox.warmupRole === "partner";
  const filter = HISTORY_FILTERS.includes(search.show as HistoryFilter) ? (search.show as HistoryFilter) : undefined;
  const q = (search.q ?? "").trim();
  const requested = readPage(search);
  let { total, rows } = await warmupThreads(userId, mailbox.id, { filter, q, paging: requested });
  // A page past the end (an old link): show the last page instead.
  const paging = clampPage(requested, total);
  if (paging.page !== requested.page) ({ total, rows } = await warmupThreads(userId, mailbox.id, { filter, q, paging }));
  const info = pageInfo(paging, total, rows.length);
  const stats = await warmupHistoryStats(userId, mailbox.id);
  const path = `/warmup/${mailbox.id}`;
  const listSearch = { ...search, tab: "conversations" };

  return (
    <div className="space-y-3">
      <p className="px-1 text-[13px] text-muted">
        Since the start: <span className="font-semibold text-fg tabular-nums">{stats.conversations}</span> conversations ·{" "}
        <span className="font-semibold text-primary tabular-nums">{stats.sent}</span> emails you sent ·{" "}
        <span className="font-semibold text-fg tabular-nums">{stats.received}</span> received
      </p>
      <ListSearch value={q} placeholder="Search by mailbox or subject" hidden={{ tab: "conversations", show: filter }} />
      <FilterChips
        path={path}
        search={listSearch}
        param="show"
        options={[
          { label: "All" },
          // A partner never starts a conversation, so both of these would list the same ones.
          ...(isPartner
            ? []
            : [
                { value: "started", label: "You started" },
                { value: "received", label: "Others started" },
              ]),
          { value: "spam", label: "Landed in spam" },
          { value: "planned", label: "Waiting to send" },
        ]}
      />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={filter === "planned" && !q ? "Nothing waiting" : q || filter ? "No conversations match" : "No warm-up emails yet"}
            description={
              filter === "planned" && !q
                ? "Emails planned for later today show up here until they're sent."
                : q || filter
                  ? "Try another search or filter."
                  : mailbox.warmupEnabled
                    ? "The first ones go out during your send window. They show up here as soon as they're sent."
                    : "Turn on warm-up in the Settings tab to start."
            }
          />
        ) : (
          <ul className="divide-y">
            {rows.map((t) => (
              <li key={t.threadId}>
                <ConversationRow t={t} mailboxId={mailbox.id} />
              </li>
            ))}
          </ul>
        )}
        <Pagination info={info} path={path} search={listSearch} noun="conversations" />
      </Card>
    </div>
  );
}
