import { redirect } from "next/navigation";

// The warm-up history moved to the Warm-up menu; old links (and bookmarks) land on its Conversations tab.
export default async function OldWarmupHistory({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (value && key !== "tab") search.set(key, value);
  search.set("tab", "conversations");
  redirect(`/warmup/${encodeURIComponent(id)}?${search}`);
}
