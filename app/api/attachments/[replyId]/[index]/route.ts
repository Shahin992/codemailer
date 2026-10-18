import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { getMemberSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { replies } from "@/lib/db/schema";
import { storedPath } from "@/lib/storage";

export async function GET(_request: Request, { params }: { params: Promise<{ replyId: string; index: string }> }) {
  const me = await getMemberSession();
  if (!me) return new Response("Not signed in", { status: 401 });
  const { replyId, index } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(replyId)) return new Response("Not found", { status: 404 });
  const [reply] = await db.select({ attachments: replies.attachments }).from(replies).where(and(eq(replies.id, replyId), eq(replies.userId, me.id)));
  const attachment = reply?.attachments[Number(index)];
  if (!attachment) return new Response("Not found", { status: 404 });

  const file = storedPath(attachment.path);
  if (!file) return new Response("Not found", { status: 404 });
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
