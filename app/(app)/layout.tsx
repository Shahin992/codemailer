import { and, eq, isNull, sql } from "drizzle-orm";
import { logout } from "@/app/actions/auth";
import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { replies } from "@/lib/db/schema";
import { optionalEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  const [unread] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(replies)
    .where(and(isNull(replies.readAt), eq(replies.isAutoReply, false)));
  return (
    <AppShell unreadReplies={unread?.n ?? 0} signOut={logout} user={{ name: user.name, email: user.email }} vapidPublicKey={optionalEnv("VAPID_PUBLIC_KEY") ?? ""}>
      {children}
    </AppShell>
  );
}
