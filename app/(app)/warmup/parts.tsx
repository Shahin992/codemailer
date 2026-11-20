// Small pieces shared by the Warm-up pages: the "where did it land" marker, the inbox score ring and
// the labels that tell this mailbox's own emails ("You") from the other mailbox's.
import { ArrowDownLeft, ArrowUpRight, CircleAlert, Clock, Inbox, Mail, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";

/** The shared name avatar (kept here too so the warm-up pages' imports stay short). */
export { Avatar } from "@/components/ui";

type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";
const PILL_TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-neutral-soft text-muted",
  primary: "bg-primary-soft text-primary",
};

export function Pill({ tone, icon, children, className }: { tone: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", PILL_TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export type Placement = {
  status: string;
  landedIn: "inbox" | "spam" | null;
  rescuedAt: Date | null;
};

/**
 * Where one email is now: waiting, in the inbox, in spam, moved out of spam, or failed. With `mine` it says
 * whose inbox: "their inbox" for an email this mailbox sent, "your inbox" for one it received.
 */
export function PlacementPill({ m, mine }: { m: Placement; mine?: boolean }) {
  const icon = "size-3.5";
  const where = mine === undefined ? "" : mine ? "their " : "your ";
  if (m.status === "scheduled") return <Pill tone="neutral" icon={<Clock className={icon} />}>Waiting to send</Pill>;
  if (m.status === "sending") return <Pill tone="info" icon={<Send className={icon} />}>Sending</Pill>;
  if (m.status === "failed") return <Pill tone="danger" icon={<CircleAlert className={icon} />}>Failed</Pill>;
  if (m.landedIn === "spam" && m.rescuedAt)
    return <Pill tone="warning" icon={<ShieldCheck className={icon} />}>Landed in {where}spam · moved to inbox</Pill>;
  if (m.landedIn === "spam") return <Pill tone="danger" icon={<ShieldAlert className={icon} />}>In {where}spam</Pill>;
  if (m.landedIn === "inbox") return <Pill tone="success" icon={<Inbox className={icon} />}>Reached {where || "the "}inbox</Pill>;
  return <Pill tone="info" icon={<Mail className={icon} />}>Sent, not found yet</Pill>;
}

/**
 * Whose email it is, seen from the mailbox being looked at: "You" (this mailbox sent it) or "Received"
 * (the other mailbox sent it). Same colours everywhere: blue for yours, grey for theirs.
 */
export function WhoTag({ mine, className }: { mine: boolean; className?: string }) {
  const icon = "size-3.5";
  return mine ? (
    <Pill tone="primary" icon={<ArrowUpRight className={icon} />} className={className}>
      You sent
    </Pill>
  ) : (
    <Pill tone="neutral" icon={<ArrowDownLeft className={icon} />} className={className}>
      Received
    </Pill>
  );
}

export type ScoreTone = "success" | "warning" | "danger" | "neutral";

/** 90 and up is good, 75–89 fair, under 75 needs care (what the common warm-up tools aim for). */
export function scoreTone(score: number | null): ScoreTone {
  if (score === null) return "neutral";
  return score >= 90 ? "success" : score >= 75 ? "warning" : "danger";
}

export function scoreLabel(score: number | null): string {
  if (score === null) return "No data yet";
  return score >= 90 ? "Good" : score >= 75 ? "Fair" : "Needs care";
}

const RING: Record<ScoreTone, string> = {
  success: "stroke-success",
  warning: "stroke-warning",
  danger: "stroke-danger",
  neutral: "stroke-transparent",
};
const TEXT: Record<ScoreTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-muted",
};

/** The inbox score as a ring with the number in the middle ("96%"), or "—" before there's anything to score. */
export function ScoreRing({ score, size = "md", label }: { score: number | null; size?: "sm" | "md" | "lg"; label?: string }) {
  const px = size === "lg" ? 96 : size === "md" ? 52 : 40;
  const stroke = size === "lg" ? 8 : 5;
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: px, height: px }}
      role="img"
      aria-label={label ?? (score === null ? "No inbox score yet" : `Inbox score ${score}%`)}
    >
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={px / 2} cy={px / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-neutral-soft" />
        {score !== null && (
          <circle
            cx={px / 2}
            cy={px / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.max(score, 2) / 100)}
            className={RING[tone]}
          />
        )}
      </svg>
      <span
        className={cn(
          "relative font-bold tracking-tight tabular-nums",
          size === "lg" ? "text-2xl" : size === "md" ? "text-[13px]" : "text-[11px]",
          TEXT[tone],
        )}
        aria-hidden
      >
        {score === null ? "—" : `${score}%`}
      </span>
    </div>
  );
}
