import type { Metadata } from "next";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { LogOut, ShieldCheck } from "lucide-react";
import { superAdminLogout } from "@/app/actions/auth";
import { FilterChips, ListSearch, Pagination } from "@/components/pagination";
import { Card, EmptyState, Stat } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { clampPage, pageInfo, readPage } from "@/lib/pagination";
import { PasswordCard } from "../(app)/settings/team";
import { AccountRow, type Account } from "./accounts";

export const metadata: Metadata = { title: "Super admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUSES = ["pending", "active", "disabled"] as const;
type Search = { q?: string; status?: string; page?: string; size?: string };

function Header({ email }: { email: string }) {
  return (
    <header className="safe-top border-b bg-card">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="/brand/coldmailer-mark.svg" alt="" width={32} height={32} className="rounded-lg" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-sm font-semibold">
              <ShieldCheck className="size-4 text-primary" aria-hidden /> Super admin
            </p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
        </div>
        <form action={superAdminLogout}>
          <button className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-neutral-soft hover:text-fg">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

export default async function SuperAdminPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireSuperAdmin();
  const search = await searchParams;
  const q = (search.q ?? "").trim();
  const status = STATUSES.find((s) => s === search.status);
  const filters: SQL[] = [eq(users.role, "member")];
  if (status) filters.push(eq(users.status, status));
  if (q) filters.push(or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`))!);
  const where = and(...filters);

  const [[{ total }], byStatus] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(users).where(where),
    db.select({ status: users.status, n: sql<number>`count(*)::int` }).from(users).where(eq(users.role, "member")).groupBy(users.status),
  ]);
  const paging = clampPage(readPage(search), total);
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, status: users.status, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
    .from(users)
    .where(where)
    // Sign-ups waiting for approval first, then the newest accounts.
    .orderBy(sql`${users.status} = 'pending' desc`, desc(users.createdAt), desc(users.id))
    .limit(paging.pageSize)
    .offset(paging.offset);
  const info = pageInfo(paging, total, rows.length);
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s.n]));
  const everyone = byStatus.reduce((sum, s) => sum + s.n, 0);
  const accounts: Account[] = rows.map((r) => ({ ...r, lastLoginAt: r.lastLoginAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }));

  return (
    <>
      <Header email={me.email} />
      <main className="safe-bottom mx-auto max-w-3xl space-y-5 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">Accounts</h1>
          <p className="mt-1 text-sm text-muted">Nobody can use ColdMailer until you approve their sign-up. Each account's mailboxes, campaigns and replies stay private to it.</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Waiting" value={counts.pending ?? 0} href="/superadmin?status=pending" />
          <Stat label="Active" value={counts.active ?? 0} href="/superadmin?status=active" />
          <Stat label="Disabled" value={counts.disabled ?? 0} href="/superadmin?status=disabled" />
        </div>

        <div className="space-y-3">
          <ListSearch value={q} placeholder="Search by email or name" hidden={{ status }} />
          <FilterChips
            path="/superadmin"
            search={search}
            param="status"
            options={[
              { label: "All", count: everyone },
              { value: "pending", label: "Waiting", count: counts.pending ?? 0 },
              { value: "active", label: "Active", count: counts.active ?? 0 },
              { value: "disabled", label: "Disabled", count: counts.disabled ?? 0 },
            ]}
          />
        </div>

        <Card>
          {accounts.length === 0 ? (
            <EmptyState
              title={everyone === 0 ? "No sign-ups yet" : "Nobody matches"}
              description={everyone === 0 ? "People who create an account at /register show up here for approval." : q ? `Nothing found for “${q}”.` : "Try another filter."}
            />
          ) : (
            <ul className="divide-y">
              {accounts.map((a) => (
                <AccountRow key={a.id} account={a} />
              ))}
            </ul>
          )}
          <Pagination info={info} path="/superadmin" search={search} noun="accounts" />
        </Card>

        <PasswordCard />
      </main>
    </>
  );
}
