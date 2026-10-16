import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { Time } from "@/components/client";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { appUrl, optionalEnv } from "@/lib/env";
import { getJobStatus } from "@/lib/job-status";
import { getSettings } from "@/lib/settings";
import { PushToggle } from "../replies/push-toggle";
import { SettingsForm } from "./settings-form";
import { ApiTokenCreator } from "./api-token";
import { PasswordCard, TeamCard, type TeamMember } from "./team";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireSession();
  const [settings, jobs, team] = await Promise.all([
    getSettings(),
    getJobStatus(),
    me.role === "admin"
      ? db
          .select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
          .from(users)
          .orderBy(asc(users.createdAt))
      : Promise.resolve([]),
  ]);
  const members: TeamMember[] = team.map((m) => ({ ...m, lastLoginAt: m.lastLoginAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString() }));
  const apiReady = Boolean(optionalEnv("API_KEY"));
  const base = appUrl();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Settings" />

      <SettingsForm
        initial={{
          footerText: settings.footerText,
          optOutLine: settings.optOutLine,
          windowStart: settings.windowStart,
          windowEnd: settings.windowEnd,
          timezone: settings.timezone,
          weekdaysOnly: settings.weekdaysOnly,
          testEmail: settings.testEmail ?? me.email,
        }}
      />

      {me.role === "admin" && <TeamCard members={members} meId={me.id} />}
      <PasswordCard />

      <section className="space-y-2">
        <h2 className="font-semibold">Reply notifications</h2>
        <PushToggle vapidPublicKey={optionalEnv("VAPID_PUBLIC_KEY") ?? ""} />
        <p className="text-xs text-muted">
          Install the app for the best experience: on a phone use “Add to Home Screen”; on a computer use the install icon in the address bar.
        </p>
      </section>

      <Card>
        <CardHeader title="Background jobs" description="Cron calls these. If they stop, nothing sends and no replies come in." />
        <ul className="divide-y">
          {jobs.map((job) => (
            <li key={job.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{job.name === "send" ? "Send emails (every minute)" : "Check inboxes (every 5 minutes)"}</p>
                <p className="text-xs break-words text-muted">
                  {job.lastRunAt ? (
                    <>
                      Last run <Time value={job.lastRunAt} mode="relative" />
                      {job.lastResult ? ` · ${job.lastResult}` : ""}
                    </>
                  ) : (
                    "Never run"
                  )}
                </p>
                {job.lastError && <p className="text-xs break-words text-danger">{job.lastError}</p>}
              </div>
              <Badge tone={job.healthy ? "success" : "danger"}>{job.healthy ? "running" : "not running"}</Badge>
            </li>
          ))}
        </ul>
        {!jobs.every((j) => j.healthy) && (
          <div className="border-t p-4 md:p-5">
            <Alert tone="warning" title="Start the cron runner">
              Run <code>npm run cron</code> next to the app (or add the crontab lines from the README).
            </Alert>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="API" description="For the MCP server or your own scripts. Requests carry a JWT: Authorization: Bearer <token>." />
        <div className="space-y-4 p-4 text-sm md:p-5">
          <ApiTokenCreator />
          <p className="text-xs text-muted">Or let a script get its own token with an account's email and password:</p>
          <pre className="overflow-x-auto rounded-lg bg-neutral-soft p-3 text-xs leading-relaxed">{`curl -X POST ${base}/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"email": "you@yourdomain.com", "password": "…", "days": 30}'
# → {"access_token": "eyJ…", "token_type": "Bearer", "expires_in": 2592000, …}

curl -X POST ${base}/api/v1/campaigns \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "October outreach",
    "recipients": ["jane@clinic.com", {"email": "dr.smith@example.com", "name": "Dr. Smith"}],
    "senders": ["support@yourdomain.com"],
    "subject": "Quick question",
    "body_text": "Hi {{first_name|there}}, ..."
  }'`}</pre>
          <p className="text-xs text-muted">
            Also: <code>GET /api/v1/campaigns/:id</code>, <code>GET /api/v1/replies?since=ISO-date</code>, <code>GET /api/v1/recipients/lookup?email=</code>,{" "}
            <code>GET /api/v1/senders</code>.
            {apiReady && " The API_KEY from .env also works as a Bearer token."}
          </p>
        </div>
      </Card>
    </div>
  );
}
