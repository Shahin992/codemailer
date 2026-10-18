import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSession();
  if (session) redirect(session.role === "superadmin" ? "/superadmin" : "/");
  const { next } = await searchParams;
  return (
    <AuthShell title={`Sign in to ${APP_NAME}`}>
      <LoginForm next={next ?? "/"} />
    </AuthShell>
  );
}
