// The Overview tab of one warm-up mailbox: its inbox score, the ramp, the last 14 days, where its emails
// landed and the latest conversations. Display only; the switch and numbers are on the Settings tab.
import type { ReactNode } from "react";
import Link from "next/link";
import { Alert, Card, CardHeader, DetailList, Progress, cn } from "@/components/ui";
import type { Sender } from "@/lib/db/schema";
import type { ThreadSummary } from "@/lib/warmup/history";
import { isGmailMailbox } from "@/lib/warmup/schedule";
import { inboxScore, type WarmupDay, type WarmupDetail } from "@/lib/warmup/status";
import { ScoreRing, scoreLabel, scoreTone } from "../parts";
import { ConversationRow } from "./conversations";
import { DailyChart } from "./daily-chart";

type Tone = "success" | "warning" | "danger" | undefined;

// Sender names that aren't a person's: warm-up emails are signed with the sender's first name and the From line shows it.
const NOT_A_NAME = /^(gmail|google|googlemail|outlook|hotmail|yahoo|hostinger|zoho|mail|email|e-mail|inbox|support|info|admin|test|user)$/i;

/** Days and score most warm-up tools suggest before running campaigns from a new mailbox. */
const READY_DAY = 14;
const READY_SCORE = 90;

function Figure({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "";
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <p className="truncate text-xs text-muted">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", color)}>{value}</p>
      {hint && <p className="text-xs leading-snug text-muted">{hint}</p>}
    </div>
  );
}

/** "2 of 40 (5%)" with a colour: none in spam is good, a few is a warning, more is bad. */
function spamValue(spam: number, found: number): { text: string; tone: Tone } {
  if (!found) return { text: "—", tone: undefined };
  const pct = Math.round((spam / found) * 100);
  return { text: `${spam} of ${found} (${pct}%)`, tone: pct === 0 ? "success" : pct <= 10 ? "warning" : "danger" };
}

/** The things that stop warm-up or make it look odd, each with what to do. */
function Alerts({ sender, detail }: { sender: Sender; detail: WarmupDetail }) {
  const on = sender.warmupEnabled;
  const isPartner = sender.warmupRole === "partner";
  const noInbox = !sender.readInbox || !sender.imapHost;
  const businessPeers = detail.partners.filter((p) => !p.partner);
  const busiestDay = isPartner
    ? Math.round(sender.warmupReceiveMax * (sender.warmupReplyRate / 100)) + 1
    : Math.round(sender.warmupMax * (1 + sender.warmupReplyRate / 100));
  const mailbox = `/mailboxes/${sender.id}`;
  const link = (href: string, text: string) => (
    <Link href={href} className="font-semibold underline underline-offset-2">
      {text}
    </Link>
  );
  return (
    <>
      {!on && (
        <Alert tone="info" title="Warm-up is off">
          This mailbox isn&apos;t warming up. Turn it on in the {link(`/warmup/${sender.id}?tab=settings`, "Settings tab")}.
        </Alert>
      )}
      {isGmailMailbox(sender) && !isPartner && (
        <Alert tone="info" title="A Gmail account">
          If this is one of your own Gmail accounts for warm-up (not for sending campaigns), set <strong>Takes part as</strong> to <strong>Partner</strong> in
          the {link(`/warmup/${sender.id}?tab=settings`, "Settings tab")}. It then only receives a few warm-up emails a day and replies, and shows how often
          your business mailboxes land in Gmail spam.
        </Alert>
      )}
      {(on || isPartner) && (!sender.displayName?.trim() || NOT_A_NAME.test(sender.displayName.trim())) && (
        <Alert tone="warning" title="Give it a person's name">
          Warm-up emails are signed with the sender&apos;s first name, and the From line shows the sender name
          {sender.displayName?.trim() ? `, now “${sender.displayName.trim()}”` : ", which is empty now"}. Set a real name (for example “Mark”) in the{" "}
          {link(`${mailbox}?tab=settings`, "mailbox settings")} and press Test and save.
        </Alert>
      )}
      {on && !isPartner && !detail.partners.length && (
        <Alert tone="warning" title="Waiting for a partner">
          No other mailbox in this account has warm-up on. Turn it on for at least one more mailbox; they warm each other up.
        </Alert>
      )}
      {on && isPartner && !businessPeers.length && (
        <Alert tone="warning" title="Nothing sends to it yet">
          No business mailbox in this account has warm-up on. Partners only answer; turn warm-up on for the mailboxes you send campaigns from.
        </Alert>
      )}
      {on && sender.status !== "active" && (
        <Alert tone="warning">This mailbox is paused, so it takes no part in warm-up until you resume it on the {link(mailbox, "mailbox page")}.</Alert>
      )}
      {on && noInbox && (
        <Alert tone="warning">
          This mailbox no longer reads its inbox (IMAP), so it takes no part in warm-up. Turn reading back on in the {link(`${mailbox}?tab=settings`, "mailbox settings")}, or
          turn warm-up off.
        </Alert>
      )}
      {on && !sender.junkFolder && (
        <Alert tone="info">
          No spam folder was found for this mailbox, so warm-up emails that land in its spam can&apos;t be moved back. Press Test connection on the{" "}
          {link(mailbox, "mailbox page")} to look again.
        </Alert>
      )}
      {on && busiestDay >= sender.dailyLimit && (
        <Alert tone="warning" title="Warm-up can fill the daily limit">
          At its busiest, warm-up sends about {busiestDay} emails a day from this mailbox, and its daily limit is {sender.dailyLimit}.
          {isPartner
            ? " Raise the daily limit (mailbox settings) or lower its reply rate."
            : " Warm-up and campaigns share that limit, so raise the daily limit (mailbox settings) or lower the warm-up maximum to leave room for campaigns."}
        </Alert>
      )}
    </>
  );
}

/** The score, what it means, and (for a business mailbox) where the ramp is. */
function Health({ sender, detail, receivedSpam }: { sender: Sender; detail: WarmupDetail; receivedSpam: number }) {
  const isPartner = sender.warmupRole === "partner";
  // Business mailbox: its own emails the other side found. Partner: emails it got, inbox or its spam.
  const score = isPartner ? inboxScore(detail.week.received, receivedSpam) : inboxScore(detail.week.found, detail.week.spam);
  const tone = scoreTone(score);
  const toneText = { success: "text-success", warning: "text-warning", danger: "text-danger", neutral: "text-muted" }[tone];
  const day = detail.day;

  let advice: string;
  if (isPartner) {
    advice =
      score === null
        ? "Shows once it has received its first warm-up emails."
        : `${detail.week.received - receivedSpam} of ${detail.week.received} warm-up emails from your business mailboxes reached its inbox in the last 7 days${receivedSpam ? "; the others landed in its spam" : ""}.`;
  } else if (score === null) {
    advice = "Shows once the other mailboxes have found its first warm-up emails.";
  } else {
    const found = `${detail.week.found - detail.week.spam} of ${detail.week.found} of its warm-up emails reached the inbox in the last 7 days.`;
    if (day !== null && day < READY_DAY)
      advice = `${found} Give it about ${READY_DAY - day} more ${READY_DAY - day === 1 ? "day" : "days"}: most senders wait for day ${READY_DAY} and a score over ${READY_SCORE}% before campaigns.`;
    else if (score < READY_SCORE) advice = `${found} Under ${READY_SCORE}%: keep campaigns light until it climbs.`;
    else advice = `${found} Looks ready for campaigns. Keep warm-up on while you send.`;
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 p-4 md:p-5">
        <ScoreRing score={score} size="lg" />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted">{isPartner ? "Your mail in its inbox, 7 days" : "Inbox score, 7 days"}</p>
          <p className={cn("text-lg font-bold", toneText)}>{scoreLabel(score)}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{advice}</p>
        </div>
      </div>
      {!isPartner && sender.warmupEnabled && day !== null && detail.target !== null && (
        <div className="border-t px-4 py-3.5 md:px-5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-semibold">Day {day}</span>
            <span className="text-right text-muted tabular-nums">
              {detail.target} of {sender.warmupMax} new emails a day
            </span>
          </div>
          <div className="mt-2">
            <Progress value={detail.target} max={sender.warmupMax} tone={detail.target >= sender.warmupMax ? "success" : "primary"} />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {detail.target >= sender.warmupMax
              ? "At the full number; it stays here."
              : detail.maxReachedOnDay
                ? `Reaches ${sender.warmupMax} a day on day ${detail.maxReachedOnDay}.`
                : "Stays at this number (no daily increase set)."}
          </p>
        </div>
      )}
    </Card>
  );
}

export function OverviewTab({
  sender,
  detail,
  days,
  recent,
  totalConversations,
  receivedSpam,
}: {
  sender: Sender;
  detail: WarmupDetail;
  /** Others' warm-up emails that landed in this mailbox's spam in the last 7 days. */
  receivedSpam: number;
  days: WarmupDay[];
  recent: ThreadSummary[];
  totalConversations: number;
}) {
  const isPartner = sender.warmupRole === "partner";
  const businessPeers = detail.partners.filter((p) => !p.partner);
  const gmailPartners = detail.partners.filter((p) => p.partner && p.gmail);
  const showGmail = gmailPartners.length > 0 || detail.week.gmailFound > 0;
  const gmail = spamValue(detail.week.gmailSpam, detail.week.gmailFound);
  const elsewhere = spamValue(detail.week.spam - detail.week.gmailSpam, detail.week.found - detail.week.gmailFound);
  const all = spamValue(detail.week.spam, detail.week.found);
  const peers = isPartner ? businessPeers : detail.partners;

  return (
    <div className="space-y-4">
      <Alerts sender={sender} detail={detail} />
      <Health sender={sender} detail={detail} receivedSpam={receivedSpam} />

      {/* Today, at a glance */}
      <Card className="grid grid-cols-3 gap-px overflow-hidden bg-border">
        {isPartner ? (
          <>
            <Figure label="Got today" value={detail.today.receivedNew} hint={`at most ${sender.warmupReceiveMax} a day`} />
            <Figure label="Replied today" value={detail.today.repliesSent} />
            <Figure label="Got, 7 days" value={detail.week.received} hint={`${detail.week.repliesSent} replied`} />
          </>
        ) : (
          <>
            <Figure
              label="You sent today"
              value={detail.today.newSent + detail.today.repliesSent}
              hint={detail.today.stillToSend ? `${detail.today.stillToSend} still to go` : `${detail.today.repliesSent} of them replies`}
            />
            <Figure label="Received today" value={detail.today.received} hint="from the others" />
            <Figure label="Replies got, 7 days" value={detail.week.repliesReceived} hint={`you replied ${detail.week.repliesSent}`} />
          </>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Last 14 days"
          description={isPartner ? "Warm-up emails it got each day, by where they landed." : "Emails this mailbox sent each day, by where the other mailbox found them."}
        />
        <div className="p-4 md:p-5">
          <DailyChart days={days} mode={isPartner ? "received" : "sent"} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Where the emails landed" description="Last 7 days." />
        <DetailList
          items={
            isPartner
              ? [
                  { label: "Got from your mailboxes", value: detail.week.received },
                  {
                    label: "Landed in its spam",
                    value: <span className={receivedSpam ? "text-warning" : undefined}>{receivedSpam}</span>,
                  },
                  { label: "Moved out of its spam", value: detail.week.rescuedHere },
                  { label: "Replies it sent", value: detail.week.repliesSent },
                  { label: "Moved out of its spam, all time", value: detail.allTime.rescuedHere },
                ]
              : [
                  ...(showGmail
                    ? [
                        { label: "Your emails in Gmail spam", value: <span className={gmailTone(gmail.tone)}>{gmail.text}</span> },
                        { label: "In spam at your other mailboxes", value: <span className={gmailTone(elsewhere.tone)}>{elsewhere.text}</span> },
                      ]
                    : [{ label: "Your emails in spam", value: <span className={gmailTone(all.tone)}>{all.text}</span> }]),
                  { label: "Moved back to the inbox", value: detail.week.movedBack },
                  {
                    label: "Sent, not found yet",
                    value: <span className={detail.week.notFound ? "text-warning" : undefined}>{detail.week.notFound}</span>,
                  },
                  { label: "Others' emails rescued from its spam", value: detail.week.rescuedHere },
                  ...(detail.week.failed ? [{ label: "Failed to send", value: <span className="text-danger">{detail.week.failed}</span> }] : []),
                  {
                    label: "Since the start",
                    value: `${detail.allTime.sent} sent · ${detail.allTime.spam} in spam (${detail.allTime.movedBack} moved back)`,
                    wide: true,
                  },
                ]
          }
        />
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Latest conversations"
          description={`${isPartner ? "Gets warm-up emails from" : "Trades emails with"} ${peers.length ? peers.map((p) => p.email).join(", ") : "no other mailbox yet"}.`}
          action={
            totalConversations > recent.length ? (
              <Link href={`/warmup/${sender.id}?tab=conversations`} className="text-sm font-semibold whitespace-nowrap text-primary hover:underline">
                See all {totalConversations}
              </Link>
            ) : undefined
          }
        />
        {recent.length ? (
          <ul className="divide-y border-t">
            {recent.map((t) => (
              <li key={t.threadId}>
                <ConversationRow t={t} mailboxId={sender.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t px-4 py-6 text-center text-sm text-muted md:px-5">
            {sender.warmupEnabled ? "The first warm-up emails show up here as soon as they're sent." : "No warm-up emails yet."}
          </p>
        )}
      </Card>
    </div>
  );
}

function gmailTone(tone: Tone): string | undefined {
  return tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : undefined;
}
