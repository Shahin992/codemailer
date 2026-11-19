// Warm-up email text: short, ordinary workplace emails between colleagues, built from many interchangeable
// parts so no two are alike. Plain text, no links, no attachments, nothing that reads like marketing.
// Pure functions (no database), so they can be tried out on their own.

type Topic = {
  subjects: string[];
  openers: string[];
  details: string[];
  asks: string[];
  replies: string[];
};

// Days read well after "on", "by" and "until": no "tomorrow" ("Meeting on tomorrow").
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const TIMES = ["9:30", "10", "10:30", "11", "11:30", "12:30", "2", "2:30", "3", "3:30", "4"];
const MINUTES = ["10", "15", "20", "30"];
const THINGS = [
  "proposal", "report", "budget sheet", "slides", "contract draft", "schedule", "price list", "website copy",
  "onboarding guide", "quarterly plan", "client brief", "meeting notes", "project plan", "timeline", "checklist",
  "summary", "estimate", "agenda", "handbook update", "supplier list",
];
const PROJECTS = [
  "the website refresh", "the new brochure", "the client onboarding", "the Q1 plan", "the training plan",
  "the product page", "the spring event", "the supplier review", "the office move", "the newsletter redesign",
  "the support process", "the partner programme", "the pricing update", "the hiring plan",
];
const ITEMS = ["printer paper", "notebooks", "coffee", "toner", "name badges", "folders", "sticky notes", "batteries"];

const TOPICS: Record<string, Topic> = {
  meeting: {
    subjects: ["Quick call this week?", "Time for a short catch-up", "Meeting on {day}", "Can we talk {day}?", "Catch-up about the {thing}", "The {thing}"],
    openers: ["Do you have {mins} minutes on {day} to go over the {thing}?", "Would {day} at {time} work for a quick call about the {thing}?", "I'd like to go through the {thing} with you before the end of the week.", "Could we find some time on {day} to talk through the {thing}?"],
    details: ["I can do any time after {time} if that's easier.", "Happy to keep it short.", "If the afternoon suits you better, just say so.", "It shouldn't take long, there are only a couple of points.", "We can do it by phone if that's simpler."],
    asks: ["Let me know what works.", "Does that work for you?", "Just tell me a time and I'll fit around it.", "Let me know if another day is better."],
    replies: ["{day} at {time} works for me.", "That works. I'll put it in my calendar.", "Could we make it {time2} instead? I'm tied up until then.", "Sure, talk then.", "Yes, that's fine. Call me whenever you're ready.", "{day} is a bit full for me. Would the day after work?"],
  },
  review: {
    subjects: ["{Thing} draft", "Notes on the {thing}", "Updated {thing}", "Can you look over the {thing}?", "{Thing} for {day}", "Latest {thing}"],
    openers: ["I've finished a first pass at the {thing}.", "I made the changes we talked about to the {thing}.", "The latest version of the {thing} is in the shared folder.", "I've tidied up the {thing} for {project}."],
    details: ["Most of the changes are in the second half.", "I shortened the introduction and moved the numbers to the end.", "I left a few comments where I wasn't sure.", "It's a bit shorter than before, which I think helps."],
    asks: ["Could you have a look when you get a moment?", "Let me know if anything looks off.", "Any comments by {day} would be great.", "No rush, but I'd like to finish it this week."],
    replies: ["Thanks, I'll take a look this afternoon.", "Looks good to me. Just one small thing on the second page, I'll mention it when we talk.", "Got it, I'll go through it by {day}.", "Read it through, nice work. I've nothing to add.", "Thanks! I'll send my notes over {day}."],
  },
  update: {
    subjects: ["Update on {project}", "{Project} status", "Where we are with {project}", "{Project} this week", "Quick update"],
    openers: ["Quick update on {project}: {progress}.", "Just so you're in the loop, {progress}.", "Here's where we are with {project}: {progress}."],
    details: ["I'll send a fuller note at the end of the week.", "Nothing needed from you for now.", "The next step is a short review with the team.", "I'll flag it straight away if anything changes."],
    asks: ["Shout if you have questions.", "Let me know if you want more detail.", "Happy to go through it in person.", ""],
    replies: ["Thanks for the update.", "Good to hear, thanks for keeping me posted.", "Great, that timing works on our side.", "Thanks. Let me know if you need anything from me.", "Sounds like it's going well, thanks."],
  },
  question: {
    subjects: ["Quick question", "Question about the {thing}", "One thing about the {thing}", "Small question", "Checking something"],
    openers: ["Do you remember who was handling the {thing} last month?", "Is the {thing} still due on {day}, or did that change?", "Did we agree on {time} or {time2} for {day}?", "Where did we end up saving the {thing}?"],
    details: ["I couldn't find it in my notes.", "I want to make sure I'm not missing anything.", "Someone asked me and I wasn't sure.", "I'd rather check than guess."],
    asks: ["Thanks in advance.", "No rush.", "Whenever you get a second.", ""],
    replies: ["I think it's still {day}, but I'll double check.", "Yes, that's still the plan.", "Good question, let me find out and get back to you.", "It's in the shared folder under this month.", "I'm fairly sure it was {time}. I'll confirm later."],
  },
  followup: {
    subjects: ["Thanks for today", "Following up on our call", "After our chat", "Notes from {day}", "Next steps"],
    openers: ["Thanks for taking the time earlier.", "Good talking to you today.", "Thanks again for the chat about {project}."],
    details: ["I've written down the next steps and will share them shortly.", "I'll follow up on the points we discussed.", "I'll check the numbers and come back to you by {day}.", "I've already started on the first item."],
    asks: ["Let me know if I missed anything.", "Tell me if I got anything wrong.", "Speak soon.", ""],
    replies: ["Thanks, that's a good summary.", "Thanks for writing it up. Nothing to add from me.", "Great, speak {day}.", "Thanks. I'll take care of my part this week."],
  },
  lunch: {
    subjects: ["Lunch on {day}?", "Team lunch", "Coffee next week?", "Lunch plans"],
    openers: ["A few of us are getting lunch on {day} around 12:30. Want to join?", "Fancy a coffee next week? I'm free most mornings.", "We're thinking of a team lunch on {day}."],
    details: ["Nothing fancy, just the place around the corner.", "It would be nice to catch up away from the desk.", "Bring anyone else who wants to come."],
    asks: ["Let me know!", "Are you in?", "Let me know if that suits you.", ""],
    replies: ["Count me in!", "I'd love to, but {day} is busy for me. Next time?", "Sounds good, see you there.", "Yes please, see you at the usual place."],
  },
  away: {
    subjects: ["Out on {day}", "Away {day}", "My schedule next week", "Heads up for {day}"],
    openers: ["Just a heads up that I'll be out on {day}.", "I'm travelling {day}, so I'll be slower on email.", "I'll be offline for most of {day}."],
    details: ["If anything urgent comes up, give me a call.", "I'll catch up on everything when I'm back.", "The {thing} is finished, so nothing should be waiting on me."],
    asks: ["Thanks!", "Let me know if you need anything before then.", ""],
    replies: ["Thanks for letting me know.", "No problem, enjoy the time off.", "Noted, safe travels.", "Thanks. I'll hold anything non-urgent until you're back."],
  },
  supplies: {
    subjects: ["Office supplies", "The {item} order", "Delivery on {day}", "Running low on {item}"],
    openers: ["The {item} we ordered should arrive on {day}.", "We're running low on {item}.", "I'm putting together an order for {item}."],
    details: ["I'll leave them in the usual cupboard.", "It's the same supplier as last time.", "It should be cheaper if we order a bit more at once."],
    asks: ["Should I order more?", "Do you need anything added?", "Anything else we need?"],
    replies: ["Yes please, go ahead.", "Great, thanks for sorting that.", "Let's wait until next week.", "Could you add some {item2} too?"],
  },
  feedback: {
    subjects: ["Your thoughts?", "Feedback on {project}", "What do you think?", "Thoughts on {project}"],
    openers: ["I'd value your opinion on where we are with {project}.", "We're trying a different approach for {project}.", "Before we go further with {project}, I wanted your view."],
    details: ["It's still early, so nothing is fixed.", "I'm not sure the second part works yet.", "Honest thoughts are welcome."],
    asks: ["What do you think?", "Could you share a few thoughts by {day}?", "Even a quick reaction would help."],
    replies: ["I like it. The first part is much clearer now.", "Overall good. I'd keep the old ending though.", "Let me think about it and reply properly {day}.", "Looks like a good direction to me."],
  },
};

const TOPIC_KEYS = Object.keys(TOPICS);

const PROGRESS = [
  "the first part is done and the rest should be ready by {day}",
  "we're about two days behind, mostly waiting on feedback",
  "everything is on track for {day}",
  "the new version is ready for a final check",
  "we've finished the hard part",
  "the team has signed off on the first half",
];
const GREETINGS_NAMED = ["Hi {name},", "Hello {name},", "Hey {name},", "{name},", "Hi {name}!"];
const GREETINGS_PLAIN = ["Hi,", "Hello,", "Hi there,"];
const CLOSERS = ["Thanks,", "Thanks!", "Best,", "Cheers,", "Talk soon,", "Thank you,", "Best regards,", "Many thanks,", "All the best,"];
const REPLY_EXTRAS = ["", "", "", "Thanks.", "Speak soon.", "Have a good day.", "Let me know if anything changes."];

const ROLE_ADDRESSES = /^(support|info|hello|sales|contact|admin|office|team|help|mail|noreply|no-reply|billing|accounts|hr|jobs|marketing)$/i;

function pick<T>(list: T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)];
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A first name for greetings and sign-offs: from the display name, else from a personal-looking address. */
export function firstName(displayName: string | null | undefined, email: string): string | null {
  const fromDisplay = displayName?.trim().split(/\s+/)[0];
  if (fromDisplay) return fromDisplay;
  const local = email.slice(0, email.indexOf("@")).split(/[._+-]/)[0];
  if (!local || ROLE_ADDRESSES.test(local) || /\d/.test(local) || local.length < 2) return null;
  return capitalize(local.toLowerCase());
}

type Context = Partial<Record<string, string>>;

const POOLS: Record<string, string[]> = { day: DAYS, time: TIMES, mins: MINUTES, thing: THINGS, project: PROJECTS, item: ITEMS };

/**
 * Fill a template's {day}, {thing}… Each word is picked once per email and kept in `ctx`, so the subject and
 * the body talk about the same thing. {time2} and {item2} are a second, different pick.
 */
function fill(template: string, rand: () => number, ctx: Context): string {
  const get = (key: string): string => {
    if (ctx[key] === undefined) {
      if (key === "progress") ctx[key] = fill(pick(PROGRESS, rand), rand, ctx);
      else if (key === "time2" || key === "item2") {
        const base = key.slice(0, -1);
        const others = POOLS[base].filter((v) => v !== get(base));
        ctx[key] = pick(others, rand);
      } else ctx[key] = pick(POOLS[key] ?? [""], rand);
    }
    return ctx[key]!;
  };
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    if (!(lower in POOLS) && !["time2", "item2", "progress"].includes(lower)) return whole;
    const value = get(lower);
    return key === lower ? value : capitalize(value);
  });
}

/** The words an earlier email used ("Thursday", "the budget sheet"…), so a reply can refer to the same ones. */
function contextFrom(text: string): Context {
  const ctx: Context = {};
  for (const [key, pool] of Object.entries(POOLS)) {
    if (key === "mins" || key === "time") continue; // too short to find reliably
    const found = [...pool].sort((a, b) => b.length - a.length).find((v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
    if (found) ctx[key] = found;
  }
  return ctx;
}

function signature(closer: string, name: string | null): string {
  return name ? `${closer}\n${name}` : closer;
}

export type WarmupText = { topic: string; subject: string; text: string };

/** A new warm-up email from one colleague to another. */
export function newWarmupEmail(
  from: { name: string | null },
  to: { name: string | null },
  rand: () => number = Math.random,
): WarmupText {
  const topic = pick(TOPIC_KEYS, rand);
  const t = TOPICS[topic];
  const ctx: Context = {};
  const greeting = to.name ? pick(GREETINGS_NAMED, rand).replace("{name}", to.name) : pick(GREETINGS_PLAIN, rand);
  const sentences = [fill(pick(t.openers, rand), rand, ctx)];
  if (rand() < 0.8) sentences.push(fill(pick(t.details, rand), rand, ctx));
  const ask = fill(pick(t.asks, rand), rand, ctx);
  // Sometimes one paragraph, sometimes the question on its own line, like people actually write.
  const body = ask ? (rand() < 0.5 ? [sentences.join(" ") + " " + ask] : [sentences.join(" "), ask]) : [sentences.join(" ")];
  const subject = fill(pick(t.subjects, rand), rand, ctx);
  const text = [greeting, ...body, signature(pick(CLOSERS, rand), from.name)].join("\n\n") + "\n";
  return { topic, subject, text };
}

function quoteHeader(date: Date, name: string | null, email: string, timeZone: string): string {
  // The way Gmail writes it: "On Wed, Nov 19, 2026 at 10:32 AM Sam <sam@example.com> wrote:"
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date);
  return `On ${day} at ${time} ${name ? `${name} <${email}>` : email} wrote:`;
}

/** A reply in the same thread, with the earlier email quoted underneath like a mail app does. */
export function warmupReply(
  p: {
    topic: string | null;
    from: { name: string | null };
    to: { name: string | null; email: string };
    parent: { text: string; sentAt: Date };
    timeZone: string;
  },
  rand: () => number = Math.random,
): { text: string } {
  const t = TOPICS[p.topic ?? ""] ?? TOPICS[pick(TOPIC_KEYS, rand)];
  const lines: string[] = [];
  if (rand() < 0.55) lines.push(p.to.name ? pick(GREETINGS_NAMED, rand).replace("{name}", p.to.name) : pick(GREETINGS_PLAIN, rand));
  const extra = pick(REPLY_EXTRAS, rand);
  // Reuse the earlier email's words: "Thursday works for me" after an email that said Thursday. A reply that
  // would name a day is only used when the email named one.
  const ctx = contextFrom(p.parent.text);
  const fitting = t.replies.filter((r) => ctx.day !== undefined || !r.includes("{day}"));
  lines.push([fill(pick(fitting.length ? fitting : t.replies, rand), rand, ctx), extra].filter(Boolean).join(" "));
  lines.push(signature(pick(CLOSERS, rand), p.from.name));
  const quoted = p.parent.text
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => (line.startsWith(">") ? `>${line}` : `> ${line}`).trimEnd())
    .join("\n");
  const header = quoteHeader(p.parent.sentAt, p.to.name, p.to.email, p.timeZone);
  return { text: `${lines.join("\n\n")}\n\n${header}\n${quoted}\n` };
}

export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}
