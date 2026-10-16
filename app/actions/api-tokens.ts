"use server";

import { requireSession } from "@/lib/auth";
import { API_TOKEN_MAX_DAYS, signApiToken } from "@/lib/session-token";

export type ApiTokenState = { token?: string; expiresAt?: string; error?: string };

/** Issue a JWT for the signed-in user, for the MCP server or scripts. Shown once, never stored. */
export async function createApiToken(_prev: ApiTokenState, formData: FormData): Promise<ApiTokenState> {
  const me = await requireSession();
  const days = Number(formData.get("days"));
  if (!Number.isInteger(days) || days < 1 || days > API_TOKEN_MAX_DAYS) return { error: `Choose 1 to ${API_TOKEN_MAX_DAYS} days.` };
  const { token, expiresAt } = await signApiToken(me.id, days);
  return { token, expiresAt: expiresAt.toISOString() };
}
