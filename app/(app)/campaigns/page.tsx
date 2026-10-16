import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Plus } from "lucide-react";
import { Time } from "@/components/client";
import { FilterChips, ListSearch, Pagination } from "@/components/pagination";
import { ButtonLink, Card, EmptyState, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { campaignCounts, EMPTY_COUNTS } from "@/lib/campaigns";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { clampPage, pageInfo, readPage } from "@/lib/pagination";

export const metadata: Metadata = { title: "Campaigns" };

const STATUSES = ["active", "paused", "done", "cancelled"] as const;
type Search = { q?: string; status?: string; page?: string; size?: string };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const q = (search.q ?? "").trim();
  const status = STATUSES.find((s) => s === search.status);

  const filters: SQL[] = [];
  if (status) filters.push(eq(campaigns.status, status));
  if (q) filters.push(or(ilike(campaigns.name, `%${q}%`), ilike(campaigns.subject, `%${q}%`))!);
  const where = filters.length ? and(...filters) : undefined;

  const [[{ total }], statusCounts] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(campaigns).where(where),
    db.select({ status: campaigns.status, n: sql<number>`count(*)::int` }).from(campaigns).groupBy(campaigns.status),
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
        description="Each campaign sends through the mailboxes you picked, a little at a time."
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
                  return (
                    <li key={c.id}>
                      <Link href={`/campaigns/${c.id}`} className="block p-4 transition-colors hover:bg-neutral-soft md:px-5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{c.name}</p>
                            <p className="truncate text-sm text-muted">{c.subject}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {c.followUpOf && <span className="text-xs text-muted">Follow-up</span>}
                            <StatusBadge status={c.status} />
                          </div>
                        </div>
                        <div className="mt-3">
                          <Progress value={processed} max={n.total} tone={c.status === "done" ? "success" : "primary"} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                          <span>
                            <span className="font-medium text-fg tabular-nums">{n.sent.toLocaleString()}</span> / {n.total.toLocaleString()} sent
                          </span>
                          <span>
                            <span className="font-medium text-success tabular-nums">{n.replied.toLocaleString()}</span> replied
                          </span>
                          <span>
                            <span className="font-medium text-danger tabular-nums">{n.bounced.toLocaleString()}</span> bounced
                          </span>
                          {n.failed > 0 && <span className="text-danger">{n.failed.toLocaleString()} failed</span>}
                          <span className="ml-auto">
                            <Time value={c.createdAt} mode="date" />
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
