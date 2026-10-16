import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { replies } from "@/lib/db/schema";
import { storageDir } from "@/lib/mail/inbound";

export async function GET(_request: Request, { params }: { params: Promise<{ replyId: string; index: string }> }) {
  if (!(await getSession())) return new Response("Not signed in", { status: 401 });
  const { replyId, index } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(replyId)) return new Response("Not found", { status: 404 });
  const [reply] = await db.select({ attachments: replies.attachments }).from(replies).where(eq(replies.id, replyId));
  const attachment = reply?.attachments[Number(index)];
  if (!attachment) return new Response("Not found", { status: 404 });

  const root = path.resolve(storageDir());
  const file = path.resolve(root, attachment.path);
  if (!file.startsWith(root + path.sep)) return new Response("Not found", { status: 404 });
  const data = await readFile(file).catch(() => null);
  if (!data) return new Response("File is missing on the server", { status: 404 });

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
