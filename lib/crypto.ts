import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

function encryptionKey(): Buffer {
  const raw = env("ENCRYPTION_KEY").trim();
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64).");
  return key;
}

// Mailbox passwords are stored as "v1:<iv>:<tag>:<ciphertext>" (AES-256-GCM).
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Stored password has an unknown format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

type TokenPurpose = "track" | "unsub";

function signature(value: string, purpose: TokenPurpose): string {
  return createHmac("sha256", env("TRACKING_SECRET")).update(`${purpose}:${value}`).digest("base64url").slice(0, 22);
}

// Public link tokens: "<messageId>.<signature>", so nobody can guess or forge them.
export function makeToken(messageId: string, purpose: TokenPurpose): string {
  return `${messageId}.${signature(messageId, purpose)}`;
}

export function readToken(token: string, purpose: TokenPurpose): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = token.slice(0, dot);
  if (!/^[0-9a-f-]{36}$/i.test(value)) return null;
  return safeEqual(token.slice(dot + 1), signature(value, purpose)) ? value : null;
}
