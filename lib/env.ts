// Read environment variables lazily so `next build` works without a full .env.

type EnvName =
  | "DATABASE_URL"
  | "APP_URL"
  | "ADMIN_EMAIL"
  | "AUTH_SECRET"
  | "ENCRYPTION_KEY"
  | "TRACKING_SECRET"
  | "CRON_SECRET"
  | "API_KEY"
  | "VAPID_PUBLIC_KEY"
  | "VAPID_PRIVATE_KEY"
  | "VAPID_SUBJECT";

export function env(name: EnvName): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export function optionalEnv(name: EnvName): string | undefined {
  return process.env[name] || undefined;
}

export function appUrl(): string {
  return env("APP_URL").replace(/\/+$/, "");
}
