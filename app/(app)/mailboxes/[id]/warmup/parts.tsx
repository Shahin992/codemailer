// Small pieces shared by the warm-up history pages: a name avatar and the "where did it land" marker.
import { CircleAlert, Clock, Inbox, Mail, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";

const AVATAR_TONES = [
  "bg-primary-soft text-primary",
  "bg-success-soft text-success",
  "bg-info-soft text-info",
  "bg-warning-soft text-warning",
  "bg-neutral-soft text-fg",
];

function initials(name: string | null, email: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0][0].toUpperCase();
  return email.charAt(0).toUpperCase();
}

/** A round badge with someone's initials, always the same colour for the same address. */
export function Avatar({ name, email, size = "md" }: { name: string | null; email: string; size?: "sm" | "md" }) {
  let hash = 0;
  for (const ch of email.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold select-none",
        size === "sm" ? "size-7 text-[11px]" : "size-9 text-xs",
        AVATAR_TONES[hash % AVATAR_TONES.length],
      )}
    >
      {initials(name, email)}
    </span>
  );
}

type Tone = "success" | "warning" | "danger" | "info" | "neutral";
const PILL_TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-neutral-soft text-muted",
};

export function Pill({ tone, icon, children }: { tone: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", PILL_TONES[tone])}>
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

/** Where one email is now: waiting, in the inbox, in spam, moved out of spam, or failed. */
export function PlacementPill({ m }: { m: Placement }) {
  const icon = "size-3.5";
  if (m.status === "scheduled") return <Pill tone="neutral" icon={<Clock className={icon} />}>Waiting to send</Pill>;
  if (m.status === "sending") return <Pill tone="info" icon={<Send className={icon} />}>Sending</Pill>;
  if (m.status === "failed") return <Pill tone="danger" icon={<CircleAlert className={icon} />}>Failed</Pill>;
  if (m.landedIn === "spam" && m.rescuedAt) return <Pill tone="warning" icon={<ShieldCheck className={icon} />}>Landed in spam · moved to inbox</Pill>;
  if (m.landedIn === "spam") return <Pill tone="danger" icon={<ShieldAlert className={icon} />}>In spam</Pill>;
  if (m.landedIn === "inbox") return <Pill tone="success" icon={<Inbox className={icon} />}>Reached the inbox</Pill>;
  return <Pill tone="info" icon={<Mail className={icon} />}>Sent, not found yet</Pill>;
}
