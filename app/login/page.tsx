import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; registered?: string }> }) {
  if (await getSession()) redirect("/");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  const { next, registered } = await searchParams;
  const notice =
    registered === "1"
      ? { tone: "success" as const, text: "Account created. Sign in to continue." }
      : registered === "pending"
        ? { tone: "success" as const, text: "Account created. An admin needs to approve it before you can sign in." }
        : n === 0
          ? { tone: "info" as const, text: "No accounts yet. Create the admin account first, then sign in here." }
          : undefined;
  return (
    <AuthShell title={`Sign in to ${APP_NAME}`}>
      <LoginForm next={next ?? "/"} notice={notice} />
    </AuthShell>
  );
}
