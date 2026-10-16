import { Countdown, Time } from "@/components/client";
import type { QueueEstimate } from "@/lib/queue-eta";

/** "in 24m 10s · expected 3:40 PM", "in 2h 05m 00s · set for 6:00 PM", "Retrying in 9m 12s", or why it's waiting. */
export function QueueEta({ estimate, className }: { estimate?: QueueEstimate; className?: string }) {
  if (!estimate) return <span className={className}>waiting</span>;
  if (estimate.kind === "blocked") return <span className={`text-warning ${className ?? ""}`}>{estimate.reason}</span>;
  if (estimate.kind === "retry") {
    return (
      <span className={className}>
        Retrying <Countdown to={estimate.at} />
        {estimate.error ? ` · last error: ${estimate.error}` : ""}
      </span>
    );
  }
  if (estimate.kind === "scheduled") {
    return (
      <span className={className}>
        <Countdown to={estimate.due} /> · set for <Time value={estimate.at} />
        {estimate.note && <span className="text-warning"> · waiting: {estimate.note}</span>}
      </span>
    );
  }
  // Beyond a week only the date means anything.
  const farAway = estimate.at.getTime() - Date.now() > 6 * 24 * 60 * 60_000;
  return farAway ? (
    <span className={className}>
      Expected around <Time value={estimate.at} />
    </span>
  ) : (
    <span className={className}>
      <Countdown to={estimate.at} /> · expected <Time value={estimate.at} />
    </span>
  );
}
