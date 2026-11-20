import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { ChevronRight, CornerDownRight, Plus } from "lucide-react";
import { Time } from "@/components/client";
import { FilterChips, ListSearch, Pagination } from "@/components/pagination";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Progress, StatusBadge, cn } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { campaignCounts, EMPTY_COUNTS } from "@/lib/campaigns";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { clampPage, pageInfo, readPage } from "@/lib/pagination";

export const metadata: Metadata = { title: "Campaigns" };

const STATUSES = ["active", "paused", "done", "cancelled"] as const;
type Search = { q?: string; status?: string; page?: string; size?: string };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireSession();
  const search = await searchParams;
  const q = (search.q ?? "").trim();
  const status = STATUSES.find((s) => s === search.status);

  const filters: SQL[] = [eq(campaigns.userId, me.id)];
  if (status) filters.push(eq(campaigns.status, status));
  if (q) filters.push(or(ilike(campaigns.name, `%${q}%`), ilike(campaigns.subject, `%${q}%`))!);
  const where = and(...filters);

  const [[{ total }], statusCounts] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(campaigns).where(where),
    db.select({ status: campaigns.status, n: sql<number>`count(*)::int` }).from(campaigns).where(eq(campaigns.userId, me.id)).groupBy(campaigns.status),
  ]);
  const params = clampPage(readPage(search, 20), total);
  const rows = await db.select().from(campaigns).where(where).orderBy(desc(campaigns.createdAt), desc(campaigns.id)).limit(params.pageSize).offset(params.offset);
  const counts = await campaignCounts(rows.map((c) => c.id));
  const info = pageInfo(params, total, rows.length);
  const byStatus = Object.fromEntries(statusCounts.map((s) => [s.status, s.n]));
  const everything = statusCounts.reduce((sum, s) => sum + s.n, 0);

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Each campaign sends through your mailboxes a little at a time."
        action={
          <ButtonLink href="/campaigns/new">
            <Plus className="size-4" /> New campaign
          </ButtonLink>
        }
      />

      {everything === 0 ? (
        <Card>
          <EmptyState
            title="No campaigns yet"
            description="Create one by adding recipients, picking mailboxes and writing your email."
            action={<ButtonLink href="/campaigns/new">Create a campaign</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-3 space-y-3">
            <ListSearch value={q} placeholder="Search by name or subject" hidden={{ status }} />
            <FilterChips
              path="/campaigns"
              search={search}
              param="status"
              options={[
                { label: "All", count: everything },
                { value: "active", label: "Active", count: byStatus.active ?? 0 },
                { value: "paused", label: "Paused", count: byStatus.paused ?? 0 },
                { value: "done", label: "Done", count: byStatus.done ?? 0 },
                { value: "cancelled", label: "Cancelled", count: byStatus.cancelled ?? 0 },
              ]}
            />
          </div>

          <Card>
            {rows.length === 0 ? (
              <EmptyState title="No campaigns match" description={q ? `Nothing found for “${q}”.` : "Try another filter."} />
            ) : (
              <ul className="divide-y">
                {rows.map((c) => {
                  const n = counts.get(c.id) ?? EMPTY_COUNTS;
                  const processed = n.total - n.queued - n.sending;
                  const replyRate = n.sent ? Math.round((n.replied / n.sent) * 1000) / 10 : null;
                  const bounceRate = n.sent ? Math.round((n.bounced / n.sent) * 1000) / 10 : null;
                  return (
                    <li key={c.id}>
                      <Link href={`/campaigns/${c.id}`} className="group block px-4 py-4 transition-colors hover:bg-neutral-soft md:px-5">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="min-w-0 truncate text-[15px] font-semibold">{c.name}</p>
                              <StatusBadge status={c.status} />
                            </div>
                            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[13px] text-muted">
                              {c.followUpOf && <CornerDownRight className="size-3.5 shrink-0" aria-label="Follow-up" />}
                              <span className="truncate">{c.subject}</span>
                            </p>
                          </div>
                          <ChevronRight className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                        </div>

                        {/* The numbers people check first, as columns: how far it got, replies and bounces with their rates. */}
                        <div className="mt-3 grid grid-cols-3 gap-3">
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-muted uppercase">Sent</p>
                            <p className="text-sm font-semibold tabular-nums">
                              {n.sent.toLocaleString()}
                              <span className="font-normal text-muted"> / {n.total.toLocaleString()}</span>
                            </p>
                            <div className="mt-1.5">
                              <Progress value={processed} max={n.total} tone={c.status === "done" ? "success" : "primary"} />
                            </div>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-muted uppercase">Replied</p>
                            <p className="text-sm font-semibold tabular-nums">
                              <span className={n.replied ? "text-success" : ""}>{n.replied.toLocaleString()}</span>
                              {replyRate !== null && <span className="font-normal text-muted"> · {replyRate}%</span>}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-muted uppercase">Bounced</p>
                            <p className="text-sm font-semibold tabular-nums">
                              <span className={cn(n.bounced > 0 && "text-danger")}>{n.bounced.toLocaleString()}</span>
                              {bounceRate !== null && <span className="font-normal text-muted"> · {bounceRate}%</span>}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          {c.followUpOf && <Badge>Follow-up</Badge>}
                          {n.queued > 0 && <Badge tone="info">{n.queued.toLocaleString()} waiting</Badge>}
                          {n.failed > 0 && <Badge tone="danger">{n.failed.toLocaleString()} failed</Badge>}
                          <span className="ml-auto">
                            Started <Time value={c.createdAt} mode="date" />
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <Pagination info={info} path="/campaigns" search={search} noun="campaigns" />
          </Card>
        </>
      )}
    </>
  );
}
