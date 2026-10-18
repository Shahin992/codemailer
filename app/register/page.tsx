import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AuthShell } from "../login/auth-shell";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getSession()) redirect("/");
  return (
    <AuthShell title="Create an account" description="New accounts are approved by the super admin. Your mailboxes, campaigns and replies are private to you.">
      <RegisterForm />
    </AuthShell>
  );
}
