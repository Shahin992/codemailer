// Runs once when the app server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Watch mailboxes for new replies so their push notifications go out within seconds. Not awaited:
    // it keeps running in the background and must not hold up the server start.
    const { startInboxWatcher } = await import("./lib/jobs/inbox-watch");
    startInboxWatcher();
  }
}
