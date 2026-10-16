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

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  if (n === 0) redirect("/register"); // fresh install: create the admin account first
  const { next } = await searchParams;
  return (
    <AuthShell title={`Sign in to ${APP_NAME}`}>
      <LoginForm next={next ?? "/"} />
    </AuthShell>
  );
}
