import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteLogoFile, LOGO_MAX_BYTES, LogoError, readLogo, saveLogo } from "@/lib/brand-logo";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";

// The email logo: GET shows it (Settings preview), POST uploads a new one (multipart field "logo"), DELETE removes it.
// A route handler rather than a server action, whose request limit (1 MB) is too small for a 1 MB image.

export async function GET() {
  if (!(await getSession())) return new Response("Not signed in", { status: 401 });
  const current = await getSettings();
  if (!current.logoFile || !current.logoMime) return new Response("No logo", { status: 404 });
  const data = await readLogo(current.logoFile).catch(() => null);
  if (!data) return new Response("The logo file is missing on the server", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": current.logoMime,
      // The file name is its hash, so a given URL (?v=…) never changes content.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Refuse oversized uploads before reading them (multipart adds a little on top of the file itself).
  if (Number(request.headers.get("content-length") ?? 0) > LOGO_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "The logo can be up to 1 MB." }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose an image file." }, { status: 400 });
  if (file.size > LOGO_MAX_BYTES) return NextResponse.json({ error: "The logo can be up to 1 MB." }, { status: 413 });

  try {
    const stored = await saveLogo(Buffer.from(await file.arrayBuffer()));
    const before = await getSettings();
    await db.update(settings).set({ ...stored, updatedAt: new Date() }).where(eq(settings.id, 1));
    if (before.logoFile && before.logoFile !== stored.logoFile) await deleteLogoFile(before.logoFile);
    revalidatePath("/settings");
    return NextResponse.json({ ok: true, ...stored });
  } catch (err) {
    if (err instanceof LogoError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

export async function DELETE() {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const before = await getSettings();
  await db
    .update(settings)
    .set({ logoFile: null, logoMime: null, logoBytes: null, logoWidth: null, logoHeight: null, updatedAt: new Date() })
    .where(eq(settings.id, 1));
  await deleteLogoFile(before.logoFile);
  revalidatePath("/settings");
  return NextResponse.json({ ok: true });
}
