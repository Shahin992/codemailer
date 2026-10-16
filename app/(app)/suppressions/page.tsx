import type { Metadata } from "next";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { removeSuppression } from "@/app/actions/settings";
import { SubmitButton, Time } from "@/components/client";
import { FilterChips, ListSearch, Pagination } from "@/components/pagination";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { suppressions } from "@/lib/db/schema";
import { clampPage, pageInfo, readPage } from "@/lib/pagination";
import { AddSuppressionsForm } from "./add-form";

export const metadata: Metadata = { title: "Do-not-send list" };

const TONES = { bounced: "danger", unsubscribed: "warning", manual: "neutral" } as const;
const REASONS = ["bounced", "unsubscribed", "manual"] as const;
type Search = { q?: string; reason?: string; page?: string; size?: string };

export default async function SuppressionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const term = (search.q ?? "").trim().toLowerCase();
  const reason = REASONS.find((r) => r === search.reason);
  const where = and(term ? ilike(suppressions.email, `%${term}%`) : undefined, reason ? eq(suppressions.reason, reason) : undefined);

  const [[{ total }], byReason] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(suppressions).where(where),
    db.select({ reason: suppressions.reason, n: sql<number>`count(*)::int` }).from(suppressions).groupBy(suppressions.reason),
  ]);
  const paging = clampPage(readPage(search, 50), total);
  const rows = await db
    .select()
    .from(suppressions)
    .where(where)
    .orderBy(desc(suppressions.createdAt), desc(suppressions.email))
    .limit(paging.pageSize)
    .offset(paging.offset);
  const info = pageInfo(paging, total, rows.length);
  const counts = Object.fromEntries(byReason.map((r) => [r.reason, r.n]));
  const everything = byReason.reduce((sum, r) => sum + r.n, 0);

  return (
    <>
      <PageHeader
        title="Do-not-send list"
        description="These addresses are skipped in every campaign: hard bounces, unsubscribes, and anyone you add."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card className="order-2 min-w-0 lg:order-1">
          <CardHeader title={`${everything.toLocaleString()} address${everything === 1 ? "" : "es"}`} />
          <div className="space-y-3 border-b px-4 py-3 md:px-5">
            <ListSearch value={term} placeholder="Search addresses" hidden={{ reason }} />
            <FilterChips
              path="/suppressions"
              search={search}
              param="reason"
              options={[
                { label: "All", count: everything },
                { value: "bounced", label: "Bounced", count: counts.bounced ?? 0 },
                { value: "unsubscribed", label: "Unsubscribed", count: counts.unsubscribed ?? 0 },
                { value: "manual", label: "Added by hand", count: counts.manual ?? 0 },
              ]}
            />
          </div>
          {rows.length === 0 ? (
            <EmptyState title={term || reason ? "No match" : "The list is empty"} />
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.email} className="flex items-center gap-3 px-4 py-2.5 md:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.email}</span>
                    <span className="block text-xs text-muted">
                      <Time value={r.createdAt} mode="date" />
                    </span>
                  </span>
                  <Badge tone={TONES[r.reason]}>{r.reason}</Badge>
                  {r.reason === "manual" && (
                    <form action={removeSuppression.bind(null, r.email)}>
                      <SubmitButton variant="ghost" size="sm" confirm={`Allow emails to ${r.email} again?`}>
                        Remove
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Pagination info={info} path="/suppressions" search={search} noun="addresses" />
        </Card>
        <div className="order-1 lg:order-2">
          <AddSuppressionsForm />
        </div>
      </div>
    </>
  );
}
