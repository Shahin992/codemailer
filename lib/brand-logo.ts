// The logo shown with the email footer, like a signature. The image is checked by its content (not its name),
// stored under STORAGE_DIR/brand/<account id> with a name made from its hash, and embedded in each email as an inline
// image (cid:), so emails don't link to this server and the logo shows without "load images".

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Settings } from "@/lib/db/schema";
import { storageDir, storedPath } from "@/lib/storage";

import { LOGO_MAX_BYTES, LOGO_MAX_WIDTH, LOGO_MIN_WIDTH } from "@/lib/logo-limits";

export { LOGO_MAX_BYTES, LOGO_MAX_WIDTH, LOGO_MIN_WIDTH };
const MAX_PIXELS = 4000; // either side

export class LogoError extends Error {}

type ImageInfo = { mime: "image/png" | "image/jpeg" | "image/gif"; ext: "png" | "jpg" | "gif"; width: number; height: number };

/** PNG, JPEG or GIF and its size in pixels, read from the file's first bytes; null for anything else. */
export function sniffImage(buf: Buffer): ImageInfo | null {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) {
    return { mime: "image/gif", ext: "gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    // Walk the JPEG segments to the frame header (SOF), which holds the size.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: "image/jpeg", ext: "jpg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

export type StoredLogo = Pick<Settings, "logoFile" | "logoMime" | "logoBytes" | "logoWidth" | "logoHeight">;

/** Check an uploaded logo and save it in the account's own folder. Returns what to record in its settings. */
export async function saveLogo(userId: string, buf: Buffer): Promise<StoredLogo> {
  if (buf.length > LOGO_MAX_BYTES) throw new LogoError(`The logo is ${(buf.length / 1024 / 1024).toFixed(1)} MB; it can be up to 1 MB.`);
  const info = sniffImage(buf);
  if (!info) throw new LogoError("Use a PNG, JPG or GIF image. Most email apps can't show SVG or WebP.");
  if (!info.width || !info.height || info.width > MAX_PIXELS || info.height > MAX_PIXELS) {
    throw new LogoError(`The image is ${info.width}×${info.height} pixels; use one up to ${MAX_PIXELS} pixels on each side.`);
  }
  const name = `logo-${createHash("sha256").update(buf).digest("hex").slice(0, 24)}.${info.ext}`;
  // Each account has its own folder, so removing one account's logo never touches another's file.
  const relative = path.posix.join("brand", userId, name);
  const file = path.join(storageDir(), "brand", userId, name);
  await mkdir(path.dirname(file), { recursive: true });
  // Write to a temporary name first, so a half-written file is never used.
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, buf);
  await rename(temp, file);
  return { logoFile: relative, logoMime: info.mime, logoBytes: buf.length, logoWidth: info.width, logoHeight: info.height };
}

/** Remove a stored logo file (an old one after a new upload, or on removal). Missing files are fine. */
export async function deleteLogoFile(relative: string | null | undefined) {
  if (!relative?.startsWith("brand/")) return;
  const file = storedPath(relative);
  if (file) await unlink(file).catch(() => {});
}

// The file never changes under its hash name, so one copy in memory serves every email of a campaign.
let cached: { file: string; data: Buffer } | null = null;

export async function readLogo(relative: string): Promise<Buffer> {
  if (cached?.file === relative) return cached.data;
  const file = storedPath(relative);
  if (!file) throw new Error(`Invalid logo path ${relative}`);
  const data = await readFile(file);
  cached = { file: relative, data };
  return data;
}

export type EmailLogo = { content: Buffer; mime: string; filename: string; width: number; height: number };

/** The logo for an email of this style, sized for display, or null when there is none (or it isn't used for this style). */
export async function emailLogo(settings: Settings, style: "personal" | "newsletter"): Promise<EmailLogo | null> {
  if (!settings.logoFile || !settings.logoMime || !settings.logoWidth || !settings.logoHeight) return null;
  if (style === "personal" && !settings.logoInPersonal) return null;
  let content: Buffer;
  try {
    content = await readLogo(settings.logoFile);
  } catch (err) {
    // Send without the logo rather than not at all; Settings shows that the file is missing.
    console.error("[logo] could not read the logo file; sending without it", err);
    return null;
  }
  // Never wider than the image itself: scaling up looks blurry.
  const width = Math.min(Math.max(settings.logoDisplayWidth, LOGO_MIN_WIDTH), LOGO_MAX_WIDTH, settings.logoWidth);
  return {
    content,
    mime: settings.logoMime,
    filename: path.posix.basename(settings.logoFile).replace(/^logo-[0-9a-f]+/, "logo"),
    width,
    height: Math.max(1, Math.round((settings.logoHeight * width) / settings.logoWidth)),
  };
}
