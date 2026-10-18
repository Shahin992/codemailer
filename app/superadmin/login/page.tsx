import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AuthShell } from "../../login/auth-shell";
import { SuperAdminLoginForm } from "./login-form";

export const metadata: Metadata = { title: "Super admin sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SuperAdminLoginPage() {
  const session = await getSession();
  if (session?.role === "superadmin") redirect("/superadmin");
  return (
    <AuthShell title="Super admin" description="Sign in to approve and manage accounts.">
      <SuperAdminLoginForm />
    </AuthShell>
  );
}
