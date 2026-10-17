import { access } from "node:fs/promises";
import type { Metadata } from "next";
import { asc, desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { pushSubscriptions, users } from "@/lib/db/schema";
import { optionalEnv } from "@/lib/env";
import { deviceLabel } from "@/lib/push";
import { getSettings } from "@/lib/settings";
import { storedPath } from "@/lib/storage";
import { timezoneGroups } from "@/lib/timezones";
import { PushToggle, type PushDevice } from "../replies/push-toggle";
import { SettingsForm } from "./settings-form";
import { PasswordCard, TeamCard, type TeamMember } from "./team";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireSession();
  const [settings, team, subscriptions] = await Promise.all([
    getSettings(),
    me.role === "admin"
      ? db
          .select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
          .from(users)
          .orderBy(asc(users.createdAt))
      : Promise.resolve([]),
    db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        userAgent: pushSubscriptions.userAgent,
        createdAt: pushSubscriptions.createdAt,
        lastSentAt: pushSubscriptions.lastSentAt,
        lastReceivedAt: pushSubscriptions.lastReceivedAt,
        lastError: pushSubscriptions.lastError,
        lastErrorAt: pushSubscriptions.lastErrorAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, me.id))
      .orderBy(desc(pushSubscriptions.createdAt)),
  ]);
  const members: TeamMember[] = team.map((m) => ({ ...m, lastLoginAt: m.lastLoginAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString() }));
  const devices: PushDevice[] = subscriptions.map((s) => ({
    id: s.id,
    label: deviceLabel(s.userAgent),
    createdAt: s.createdAt.toISOString(),
    tail: s.endpoint.slice(-24),
    lastSentAt: s.lastSentAt?.toISOString() ?? null,
    lastReceivedAt: s.lastReceivedAt?.toISOString() ?? null,
    lastError: s.lastError,
    lastErrorAt: s.lastErrorAt?.toISOString() ?? null,
  }));

  const logoPath = settings.logoFile ? storedPath(settings.logoFile) : null;
  const logo =
    settings.logoFile && settings.logoBytes && settings.logoWidth && settings.logoHeight
      ? {
          // The file name is the image's hash, so the URL changes whenever the logo does.
          url: `/api/settings/logo?v=${encodeURIComponent(settings.logoFile.replace(/^brand\/logo-|\.\w+$/g, ""))}`,
          bytes: settings.logoBytes,
          width: settings.logoWidth,
          height: settings.logoHeight,
          missing: !logoPath || !(await access(logoPath).then(() => true, () => false)),
        }
      : null;

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
          logoDisplayWidth: settings.logoDisplayWidth,
          logoInPersonal: settings.logoInPersonal,
        }}
        zones={timezoneGroups(settings.timezone)}
        logo={logo}
      />

      <section className="space-y-2">
        <h2 className="font-semibold">Reply notifications</h2>
        <PushToggle vapidPublicKey={optionalEnv("VAPID_PUBLIC_KEY") ?? ""} devices={devices} />
        <p className="text-xs text-muted">
          Install the app for the best experience: on a phone use “Add to Home Screen”; on a computer use the install icon in the address bar.
        </p>
      </section>

      {me.role === "admin" && <TeamCard members={members} meId={me.id} />}
      <PasswordCard />
    </div>
  );
}
