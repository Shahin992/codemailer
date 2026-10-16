import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { AuthShell } from "../login/auth-shell";
import { RegisterForm } from "./register-form";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getSession()) redirect("/");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  const first = n === 0;
  return (
    <AuthShell
      title={first ? `Set up ${APP_NAME}` : "Create an account"}
      description={first ? "This first account is the admin. It can approve everyone who signs up later." : "An admin approves new accounts before they can sign in."}
    >
      <RegisterForm first={first} />
    </AuthShell>
  );
}
