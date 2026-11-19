import type { ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Time } from "@/components/client";
import { Alert, Badge, Card, CardHeader } from "@/components/ui";
import type { Sender, Settings } from "@/lib/db/schema";
import type { WarmupActivity, WarmupDetail } from "@/lib/warmup/status";
import { WarmupSettingsForm, WarmupSwitch } from "./warmup-controls";

type Tone = "success" | "warning" | "danger" | undefined;

function Figure({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "";
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function activityLabel(a: WarmupActivity): { text: string; tone: "neutral" | "success" | "warning" | "danger" | "info" } {
  if (a.status === "scheduled") return { text: "Planned", tone: "neutral" };
  if (a.status === "sending") return { text: "Sending", tone: "info" };
  if (a.status === "failed") return { text: "Failed", tone: "danger" };
  if (a.status === "cancelled") return { text: "Cancelled", tone: "neutral" };
  if (a.landedIn === "spam") return a.rescuedAt ? { text: "Spam → moved to inbox", tone: "warning" } : { text: "In spam", tone: "danger" };
  if (a.landedIn === "inbox") return { text: a.direction === "out" ? "Reached inbox" : "Received", tone: "success" };
  return { text: a.direction === "out" ? "Sent, not found yet" : "On its way", tone: "info" };
}

/** "2 of 40" with a colour: none in spam is good, a few is a warning, more is bad. */
function spamFigure(spam: number, found: number): { value: string; pct: number; tone: Tone } {
  if (!found) return { value: "—", pct: 0, tone: undefined };
  const pct = Math.round((spam / found) * 100);
  return { value: `${spam} of ${found}`, pct, tone: pct === 0 ? "success" : pct <= 10 ? "warning" : "danger" };
}

export function WarmupCard({ sender, detail, settings }: { sender: Sender; detail: WarmupDetail; settings: Settings }) {
  const on = sender.warmupEnabled;
  const isPartner = sender.warmupRole === "partner";
  const noInbox = !sender.readInbox || !sender.imapHost;
  const businessPeers = detail.partners.filter((p) => !p.partner);
  const gmailPartners = detail.partners.filter((p) => p.partner && p.gmail);
  // New emails at the maximum plus the replies to the other mailboxes' emails, roughly.
  const busiestDay = isPartner
    ? Math.round(sender.warmupReceiveMax * (sender.warmupReplyRate / 100)) + 1
    : Math.round(sender.warmupMax * (1 + sender.warmupReplyRate / 100));
  const window = `${settings.windowStart}–${settings.windowEnd} ${settings.timezone}${settings.weekdaysOnly ? ", weekdays only" : ", every day"}`;
  const all = spamFigure(detail.week.spam, detail.week.found);
  const gmail = spamFigure(detail.week.gmailSpam, detail.week.gmailFound);
  const elsewhere = spamFigure(detail.week.spam - detail.week.gmailSpam, detail.week.found - detail.week.gmailFound);
  const showGmail = gmailPartners.length > 0 || detail.week.gmailFound > 0;

  return (
    <Card>
      <CardHeader
        title="Warm-up"
        description={
          isPartner
            ? "Partner mailbox: it receives warm-up emails from your business mailboxes and replies to them in the same thread. It never starts threads or sends campaigns."
            : "Sends ordinary emails to your other warm-up mailboxes, which reply in the same thread, so this address builds a normal history of sent and received mail."
        }
        action={on ? <Badge tone="primary">{isPartner ? "Partner" : detail.day ? `Day ${detail.day}` : "On"}</Badge> : <Badge>Off</Badge>}
      />
      <div className="space-y-5 p-4 md:p-5">
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
        {on && sender.status !== "active" && <Alert tone="warning">This mailbox is paused, so it takes no part in warm-up until you resume it.</Alert>}
        {on && noInbox && (
          <Alert tone="warning">This mailbox no longer reads its inbox (IMAP), so it takes no part in warm-up. Turn reading back on, or turn warm-up off.</Alert>
        )}
        {on && !sender.junkFolder && (
          <Alert tone="info">
            No spam folder was found for this mailbox, so warm-up emails that land in its spam can&apos;t be moved back. Press Test connection above to look
            again.
          </Alert>
        )}
        {on && busiestDay >= sender.dailyLimit && (
          <Alert tone="warning" title="Warm-up can fill the daily limit">
            At its busiest, warm-up sends about {busiestDay} emails a day from this mailbox, and its daily limit is {sender.dailyLimit}.
            {isPartner
              ? " Raise the daily limit (Edit mailbox below) or lower its reply rate."
              : " Warm-up and campaigns share that limit, so raise the daily limit (Edit mailbox below) or lower the warm-up maximum to leave room for campaigns."}
          </Alert>
        )}

        {on && !isPartner && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Figure label="Warm-up day" value={detail.day ?? "—"} hint={detail.target !== null ? `Goal today: ${detail.target} new` : undefined} />
              <Figure
                label="Sent today"
                value={detail.today.newSent + detail.today.repliesSent}
                hint={`${detail.today.newSent} new, ${detail.today.repliesSent} replies${detail.today.stillToSend ? ` · ${detail.today.stillToSend} still to go` : ""}`}
              />
              <Figure label="Received today" value={detail.today.received} />
              <Figure label="Replies, 7 days" value={detail.week.repliesReceived} hint={`received · ${detail.week.repliesSent} sent`} />
            </div>
            <div className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
              {showGmail ? (
                <>
                  <Figure
                    label="In Gmail spam, 7 days"
                    value={gmail.value}
                    hint={detail.week.gmailFound ? `${gmail.pct}% · ${detail.week.gmailMovedBack} moved back to inbox` : "Nothing found at Gmail yet"}
                    tone={gmail.tone}
                  />
                  <Figure
                    label="In spam elsewhere, 7 days"
                    value={elsewhere.value}
                    hint={`${detail.week.movedBack - detail.week.gmailMovedBack} moved back · your other mailboxes`}
                    tone={elsewhere.tone}
                  />
                </>
              ) : (
                <>
                  <Figure
                    label="Landed in spam, 7 days"
                    value={all.value}
                    hint={detail.week.found ? `${all.pct}% of its emails the others found` : "Nothing found yet"}
                    tone={all.tone}
                  />
                  <Figure label="Moved back to inbox" value={detail.week.movedBack} hint="of those, by the other mailbox" />
                </>
              )}
              <Figure label="Not found yet" value={detail.week.notFound} hint="sent over an hour ago" tone={detail.week.notFound > 0 ? "warning" : undefined} />
              <Figure label="Rescued from its spam" value={detail.week.rescuedHere} hint="others' emails, 7 days" />
            </div>
          </>
        )}

        {on && isPartner && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Received today" value={detail.today.receivedNew} hint={`new emails, at most ${sender.warmupReceiveMax} a day`} />
            <Figure label="Replies sent today" value={detail.today.repliesSent} />
            <Figure label="Received, 7 days" value={detail.week.received} hint={`${detail.week.repliesSent} replies sent`} />
            <Figure
              label="Moved out of its spam, 7 days"
              value={detail.week.rescuedHere}
              hint="business mailboxes' emails that landed in its spam"
              tone={detail.week.rescuedHere > 0 ? "warning" : undefined}
            />
          </div>
        )}

        {on && (
          <p className="text-xs text-muted">
            {!isPartner &&
              `Since the start: ${detail.allTime.sent} sent, ${detail.allTime.spam} landed in spam (${detail.allTime.movedBack} moved back), ${detail.allTime.rescuedHere} rescued from this inbox's spam.`}
            {isPartner && `Since the start: ${detail.allTime.rescuedHere} warm-up emails moved out of its spam.`}
            {detail.week.failed > 0 && ` ${detail.week.failed} failed in the last 7 days.`}{" "}
            {isPartner ? "Receives from" : "Trades with"}:{" "}
            {(isPartner ? businessPeers : detail.partners).length
              ? (isPartner ? businessPeers : detail.partners).map((p) => `${p.email}${p.partner ? " (partner)" : ""}`).join(", ")
              : "none yet"}
            .
          </p>
        )}

        <WarmupSwitch
          id={sender.id}
          enabled={on}
          disabledReason={noInbox ? "Warm-up needs a mailbox whose inbox ColdMailer reads (IMAP), so it can find warm-up emails and reply." : undefined}
        />

        {detail.recent.length > 0 && (
          <div className="border-t pt-4">
            <h3 className="mb-2 text-sm font-semibold">Recent warm-up emails</h3>
            <ul className="divide-y">
              {detail.recent.map((a) => {
                const label = activityLabel(a);
                return (
                  <li key={a.id} className="flex items-start gap-3 py-2 text-sm">
                    {a.direction === "out" ? (
                      <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Sent" />
                    ) : (
                      <ArrowDownLeft className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Received" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate">
                        <span className="text-muted">{a.direction === "out" ? "To" : "From"}</span> {a.partner}
                        {a.isReply && <span className="text-muted"> · reply</span>}
                      </p>
                      <p className="truncate text-xs text-muted">{a.subject ?? "Text is written when it's sent"}</p>
                      {a.status === "failed" && a.error && <p className="text-xs break-words text-danger">{a.error}</p>}
                      {a.status === "scheduled" && a.error && <p className="text-xs break-words text-muted">{a.error}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge tone={label.tone}>{label.text}</Badge>
                      <p className="mt-0.5 text-xs text-muted">
                        <Time value={a.at} mode="relative" />
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold">Warm-up settings</h3>
          <p className="mb-3 text-xs text-muted">
            {isPartner
              ? `Replies go out 20 minutes to 5 hours after a warm-up email arrives, inside your send window (${window}; change it in Settings).`
              : `New emails go out at random times inside your send window (${window}; change it in Settings), and replies follow 15 minutes to 3 hours later.`}
            {!isPartner && detail.maxReachedOnDay && ` With these numbers it reaches ${sender.warmupMax} a day on day ${detail.maxReachedOnDay}.`}
          </p>
          <WarmupSettingsForm
            id={sender.id}
            values={{
              warmupRole: sender.warmupRole,
              warmupStart: sender.warmupStart,
              warmupIncrease: sender.warmupIncrease,
              warmupMax: sender.warmupMax,
              warmupReplyRate: sender.warmupReplyRate,
              warmupReceiveMax: sender.warmupReceiveMax,
            }}
          />
        </div>
      </div>
    </Card>
  );
}
