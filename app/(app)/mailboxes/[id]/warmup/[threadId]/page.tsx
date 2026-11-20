import { redirect } from "next/navigation";

// Warm-up conversations moved to the Warm-up menu; old links still open the same conversation.
export default async function OldWarmupConversation({ params }: { params: Promise<{ id: string; threadId: string }> }) {
  const { id, threadId } = await params;
  redirect(`/warmup/${encodeURIComponent(id)}/${encodeURIComponent(threadId)}`);
}
