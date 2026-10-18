import { NextResponse } from "next/server";
import { getMemberSession } from "@/lib/auth";

const MAX_BYTES = 30 * 1024 * 1024;

/** Turn any Google Sheets link into its CSV export URL. Only Google's own hosts are ever fetched. */
function exportUrl(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
  const gid = url.searchParams.get("gid") ?? /gid=(\d+)/.exec(url.hash)?.[1] ?? "0";
  const published = /^\/spreadsheets\/d\/e\/([\w-]+)/.exec(url.pathname);
  if (published) return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv&gid=${encodeURIComponent(gid)}`;
  const id = /^\/spreadsheets\/d\/([\w-]+)/.exec(url.pathname)?.[1];
  return id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid)}` : null;
}

async function readLimited(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Fetch a shared Google Sheet as CSV for the New campaign page. */
export async function POST(request: Request) {
  if (!(await getMemberSession())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { url } = ((await request.json().catch(() => ({}))) ?? {}) as { url?: string };
  const target = url ? exportUrl(url) : null;
  if (!target) return NextResponse.json({ error: "Paste a Google Sheets link (docs.google.com/spreadsheets/…)." }, { status: 400 });

  let res: Response;
  try {
    res = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  } catch {
    return NextResponse.json({ error: "Couldn't reach Google Sheets. Try again." }, { status: 502 });
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.includes("text/csv")) {
    return NextResponse.json(
      { error: "Google didn't share this sheet. Open it, click Share → General access → “Anyone with the link” (Viewer), then try again." },
      { status: 400 },
    );
  }
  const csv = await readLimited(res);
  if (csv === null) return NextResponse.json({ error: "The sheet is larger than 30 MB. Split it or upload a CSV instead." }, { status: 413 });
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
}
