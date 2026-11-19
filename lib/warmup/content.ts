// Warm-up email text: short, ordinary workplace emails between colleagues, plain text, no links or attachments,
// nothing that reads like marketing. Each email comes from a "scenario" (asking for a call, sharing a draft,
// checking a deadline…) with several wordings, and its replies are written for that scenario, so a thread reads
// like a real conversation:
//   1. the email ("Do you have 15 minutes on Tuesday for a quick call about the proposal?")
//   2. the reply, using the same details ("Sure, Tuesday at 2pm works for me.")
//   3. sometimes a short closing from the first sender ("Perfect, talk then.")
// The words picked for an email (day, document, project…) are saved with the thread in its topic, so the
// replies refer to exactly the same ones. Pure functions (no database), so they can be tried out on their own.

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const TIMES = ["9:30", "10am", "10:30", "11am", "11:30", "1:30", "2pm", "2:30", "3pm", "3:30", "4pm"];
const MINUTES = ["10", "15", "20", "30"];
const THINGS = [
  "proposal", "report", "budget sheet", "slides", "contract draft", "schedule", "price list", "website copy",
  "onboarding guide", "quarterly plan", "client brief", "meeting notes", "project plan", "timeline", "checklist",
  "summary", "estimate", "agenda", "style guide", "supplier list", "content calendar", "design mockups",
];
const PROJECTS = [
  "the website refresh", "the new brochure", "the client onboarding", "the Q1 plan", "the training plan",
  "the product page", "the spring event", "the supplier review", "the office move", "the newsletter redesign",
  "the support process", "the partner programme", "the pricing update", "the hiring plan", "the social media plan",
];
const ITEMS = ["printer paper", "notebooks", "coffee", "toner", "name badges", "folders", "sticky notes", "batteries"];
const TOOLS = ["task board", "shared calendar", "project tracker", "meeting notes template", "file naming system"];
const PROGRESS = [
  "the first part is done and the rest should be ready by {day}",
  "the draft is done and it's with the team for feedback",
  "everything is on track for {day}",
  "the new version is ready for a final check",
  "we've finished the hardest part",
  "the team has signed off on the first half",
];

/** Words a template can use. A second, different pick of the same kind is {day2}, {time2}, {thing2}, {item2}. */
const POOLS: Record<string, string[]> = { day: DAYS, time: TIMES, mins: MINUTES, thing: THINGS, project: PROJECTS, item: ITEMS, tool: TOOLS, progress: PROGRESS };

type Scenario = {
  subjects: string[];
  openers: string[];
  /** Optional middle sentence; "" means none. */
  details: string[];
  /** Closing question or line; "" means none. */
  asks: string[];
  /** Answers that fit this email, whichever wording it had. */
  replies: string[];
  /** The first sender's short answer back; every one must fit every reply. Empty: the thread ends after the reply. */
  closings: string[];
};

const SCENARIOS: Record<string, Scenario> = {
  "call-request": {
    subjects: ["Quick call this week?", "Time for a short call?", "Call on {day}?", "Catch-up on {day}"],
    openers: [
      "Do you have {mins} minutes on {day} for a quick call about the {thing}?",
      "Could we have a short call on {day} to go over the {thing}?",
      "Are you free for a quick chat on {day} about the {thing}?",
    ],
    details: ["Any time after {time} works for me.", "It shouldn't take long.", "Happy to do it by phone or video, whichever is easier.", ""],
    asks: ["Let me know what suits you.", "Does that work?", "Just send me a time."],
    replies: [
      "Sure, {day} at {time} works for me.",
      "Yes, I'm free on {day}. Shall we say {time}?",
      "{day} is fine. I'll call you at {time}.",
      "Sounds good. Send me an invite for {day} and I'll be there.",
    ],
    closings: ["Perfect, talk then.", "Great, it's in my calendar.", "Thanks, speak on {day}."],
  },
  "call-move": {
    subjects: ["Moving our {day} call", "Can we move {day}?", "Change of plan for {day}"],
    openers: [
      "Something came up on {day}. Could we move our call to {day2}?",
      "Would you mind if we moved our {day} call to {day2}?",
      "I'm going to be tied up on {day}. Could we do {day2} instead?",
    ],
    details: ["The same time works for me.", "Sorry for the short notice.", ""],
    asks: ["Let me know if that's OK.", "Does that work for you?"],
    replies: ["No problem, {day2} is fine.", "Sure, {day2} works. Same time?", "That's fine with me. Talk on {day2}.", "Of course. {day2} suits me better anyway."],
    closings: ["Thanks for being flexible.", "Great, same time then.", "Thanks, talk on {day2}."],
  },
  "draft-review": {
    subjects: ["{Thing} draft", "Can you look over the {thing}?", "Draft {thing} for review", "Updated {thing}"],
    openers: [
      "I've finished a first draft of the {thing}.",
      "The {thing} is ready for a second pair of eyes.",
      "I've updated the {thing} with the changes we talked about.",
    ],
    details: ["It's in the shared folder.", "Most of the changes are in the second half.", "I kept it shorter this time.", ""],
    asks: ["Could you have a look when you get a moment?", "Any comments by {day} would be great.", "Let me know what you think."],
    replies: [
      "Thanks, I'll read it this afternoon.",
      "Got it. I'll send my comments by {day}.",
      "Just read it. Looks good to me, only a couple of small typos.",
      "Nice work. I'll go through it properly tomorrow.",
    ],
    closings: ["Thanks!", "Great, thank you.", "Thanks, much appreciated."],
  },
  "find-file": {
    subjects: ["Where is the {thing}?", "Looking for the {thing}", "Latest {thing}?"],
    openers: [
      "Do you know where the latest {thing} is saved?",
      "I can't find the newest version of the {thing}. Do you have it?",
      "Which folder did the final {thing} end up in?",
    ],
    details: ["I want to make sure I'm using the right one.", "The copy I have is from last month.", ""],
    asks: ["Could you send me the link?", "Thanks in advance.", ""],
    replies: [
      "It's in the shared folder, under this month.",
      "I'll send you the link in a minute.",
      "I have it here. Sending it over now.",
      "Check the team folder. It's the one with this week's date.",
    ],
    closings: ["Found it, thanks!", "Got it, thank you.", "Perfect, thanks."],
  },
  deadline: {
    subjects: ["{Thing} deadline", "Is the {thing} still due {day}?", "Timing for the {thing}"],
    openers: [
      "Is the {thing} still due on {day}, or has that moved?",
      "Just checking: are we still aiming to finish the {thing} by {day}?",
      "Quick one: is {day} still the date for the {thing}?",
    ],
    details: ["I want to plan the rest of my week around it.", "Nothing urgent, just planning ahead.", ""],
    asks: ["Let me know.", "Thanks!", ""],
    replies: [
      "Yes, {day} is still the plan.",
      "It's moved to {day2}, so you have a bit more time.",
      "Still {day} as far as I know. I'll tell you if that changes.",
      "Yes, {day}. Let me know if you need any help with it.",
    ],
    closings: ["Great, thanks for confirming.", "Perfect, that helps.", "Thanks, good to know."],
  },
  "project-update": {
    subjects: ["Update on {project}", "{Project}: where we are", "Quick update on {project}"],
    openers: ["Quick update on {project}: {progress}.", "Just so you're in the loop on {project}: {progress}.", "Here's where we are with {project}: {progress}."],
    details: ["I'll send a fuller note at the end of the week.", "Nothing needed from you for now.", "The next step is a short review with the team.", ""],
    asks: ["Shout if you have any questions.", "Happy to go through it in more detail.", ""],
    replies: [
      "Thanks for the update.",
      "Good to hear, thanks for keeping me posted.",
      "Great progress. Let me know if you need anything from me.",
      "Thanks. That timing works on our side.",
    ],
    closings: ["Will do, thanks.", "Thanks, I will.", "Great, speak soon."],
  },
  "after-call": {
    subjects: ["Thanks for today", "Following up on our call", "Notes from our chat", "Next steps"],
    openers: ["Thanks for taking the time to talk today.", "Good speaking with you earlier.", "Thanks again for the chat about {project}."],
    details: ["I've written down the next steps and will share them shortly.", "I'll look into the points you raised and come back to you by {day}.", "I've already started on the first item."],
    asks: ["Let me know if I missed anything.", ""],
    replies: [
      "Thanks, it was a useful chat.",
      "Likewise, thanks. Looking forward to the next steps.",
      "Thanks. I'll start on my part this week.",
      "Thanks for following up so quickly.",
    ],
    closings: ["Great, thanks.", "Sounds good.", "Thanks, speak soon."],
  },
  lunch: {
    subjects: ["Catching up", "Lunch or coffee?", "Getting together"],
    openers: [
      "A few of us are getting lunch on {day} around 12:30. Want to join?",
      "Fancy a coffee one morning next week?",
      "We're thinking of a team lunch on {day}. Are you in?",
    ],
    details: ["Nothing fancy, just the place around the corner.", "It would be nice to catch up away from the desk.", ""],
    asks: ["Let me know!", ""],
    replies: ["Count me in!", "Sounds good, see you there.", "Yes please, that sounds great.", "I'd love to. Thanks for asking."],
    closings: ["Great!", "Lovely, see you then.", "Great, see you there."],
  },
  "out-of-office": {
    subjects: ["Out on {day}", "Heads up for {day}", "Away on {day}"],
    openers: ["Just a heads up that I'll be out on {day}.", "I'm travelling on {day}, so I'll be slow on email.", "I'll be offline for most of {day}."],
    details: ["If anything urgent comes up, call me.", "I'll catch up on everything when I'm back.", "The {thing} is done, so nothing should be waiting on me."],
    asks: ["Thanks!", ""],
    replies: [
      "Thanks for letting me know.",
      "No problem, enjoy the time off.",
      "Noted. Safe travels!",
      "Thanks. I'll hold anything non-urgent until you're back.",
    ],
    closings: [],
  },
  supplies: {
    subjects: ["Office supplies", "Running low on {item}", "{Item} order"],
    openers: ["We're running low on {item}.", "I'm putting together an order for {item}.", "The {item} we use is nearly gone."],
    details: ["It's the same supplier as last time.", "I'll leave them in the usual cupboard.", ""],
    asks: ["Should I order more?", "Do you need anything added?", "Shall I get the usual amount?"],
    replies: ["Yes please, go ahead.", "Could you add some {item2} too?", "Good idea, thanks for sorting it.", "Please do. We're almost out here too."],
    closings: ["Will do.", "On it.", "Sure, I'll take care of it."],
  },
  feedback: {
    subjects: ["Your thoughts on {project}?", "Feedback on {project}", "What do you think?"],
    openers: [
      "Before we go further with {project}, I'd like your view.",
      "We're trying a different approach for {project}.",
      "I've sketched out a new plan for {project}.",
    ],
    details: ["It's still early, so nothing is fixed.", "I'm not sure the second part works yet.", ""],
    asks: ["What do you think?", "Even a quick reaction would help."],
    replies: [
      "I like the direction. It's much clearer now.",
      "Overall good. I'd keep the first part as it was though.",
      "Looks promising. Let me think about it and reply properly by {day}.",
      "I think it works. Happy to talk it through if you like.",
    ],
    closings: ["Thanks, that's helpful.", "Great, thank you.", "Thanks for the quick look."],
  },
  training: {
    subjects: ["Training on {day}", "Workshop on {day}", "Training session"],
    openers: ["There's a short training session on {day} at {time}.", "We're running a workshop on {day} at {time} about the new {tool}."],
    details: ["It's about an hour.", "There will be time for questions at the end.", ""],
    asks: ["Will you be able to join?", "Can you make it?"],
    replies: ["Thanks, I'll be there.", "Great, I've put it in my calendar.", "Yes, I'll join. Thanks for organising it.", "Count me in."],
    closings: ["Great, see you there.", "Perfect, thanks.", "Great!"],
  },
  slides: {
    subjects: ["Slides from {day}", "Notes from the workshop", "Workshop slides"],
    openers: ["I've put the slides from {day}'s workshop in the shared folder.", "Here's a quick note that the workshop slides are now in the team folder."],
    details: ["Worth a look if you missed part of it.", "There's a short summary on the last page.", ""],
    asks: ["Let me know if you have questions.", ""],
    replies: ["Thanks for sharing, I'll have a look.", "Thanks! I missed part of it, so this helps.", "Great, thank you.", "Thanks, I'll go through them today."],
    closings: [],
  },
  "client-prep": {
    subjects: ["Prep for {day}'s meeting", "Before the client meeting", "Client meeting on {day}"],
    openers: [
      "Could we spend ten minutes before {day}'s client meeting going over the {thing}?",
      "For the client meeting on {day}, I'll bring the {thing}.",
      "Before we meet the client on {day}, shall we agree on the {thing}?",
    ],
    details: ["I want to make sure we're saying the same thing.", "I've made a few notes already.", ""],
    asks: ["Does that sound OK?", "Anything you want me to add?"],
    replies: ["Good idea. Let's meet 15 minutes early.", "Sounds good. I'll bring my notes too.", "Yes, let's do that. I'll have a few questions ready.", "Makes sense. See you before the meeting."],
    closings: ["Great, see you then.", "Perfect, thanks.", "Sounds good."],
  },
  thanks: {
    subjects: ["Thank you", "Great work on {project}", "Thanks for your help"],
    openers: ["Thanks again for your help with {project}.", "Just wanted to say great job on {project}.", "Thank you for stepping in on {project} last week."],
    details: ["It made a real difference.", "The team noticed too.", ""],
    asks: [""],
    replies: ["Thanks, that's kind of you!", "Thank you, happy to help anytime.", "Appreciate it! It was a team effort.", "Thanks, that means a lot."],
    closings: [],
  },
  access: {
    subjects: ["Access to the {thing}", "Can't open the {thing}", "Permission for the {thing}"],
    openers: ["I can't open the {thing} in the shared folder.", "Could you give me access to the {thing}?", "The {thing} link says I need permission."],
    details: ["I think it's still set to private.", "I'd like to read it before {day}.", ""],
    asks: ["Could you check when you have a minute?", "Thanks!"],
    replies: ["Sorry about that, I've just shared it with you.", "Done, you should have access now.", "Fixed. Try again and let me know if it still doesn't work."],
    closings: ["Works now, thanks!", "Got it, thank you.", "All good now. Thanks!"],
  },
  "week-plan": {
    subjects: ["This week", "Plans for next week", "Weekly check-in"],
    openers: [
      "Here's what I'm working on this week: the {thing} and {project}.",
      "Next week I'll mostly be on {project}.",
      "Quick check-in: this week I'm focusing on the {thing}.",
    ],
    details: ["I should have the {thing} ready by {day}.", "Let me know if priorities change.", ""],
    asks: ["Anything you need from me?", ""],
    replies: [
      "Thanks, that all sounds right.",
      "Looks good. Nothing extra from my side.",
      "Thanks. Could you also look at the {thing2} when you have time?",
      "Sounds good. Let's catch up on {day}.",
    ],
    closings: ["Sounds good.", "Sure, thanks.", "Great, thanks."],
  },
  "office-hours": {
    subjects: ["Office closed on {day}", "Office hours on {day}", "Reminder for {day}"],
    openers: ["Just a reminder that the office is closed on {day}.", "We'll be finishing early on {day}.", "Heads up: the office opens late on {day}."],
    details: ["Normal hours again the day after.", ""],
    asks: [""],
    replies: ["Thanks for the reminder.", "Good to know, thanks.", "Thanks! I'll plan around it."],
    closings: [],
  },
  "new-tool": {
    subjects: ["New {tool}", "Trying a {tool}", "{Tool} for {project}"],
    openers: ["We're starting to use a new {tool} from {day}.", "I've set up a {tool} for {project}."],
    details: ["It should make it easier to see who is doing what.", "I'll walk everyone through it.", ""],
    asks: ["Let me know if you have trouble getting in.", "Any thoughts before we start?"],
    replies: ["Sounds useful, thanks for setting it up.", "Great idea. I'll have a look today.", "Thanks. I'm in and it looks good."],
    closings: ["Great, thanks!", "Glad it helps.", "Great, let me know how you find it."],
  },
  figures: {
    subjects: ["Numbers in the {thing}", "Quick check on the figures", "Figures in the {thing}"],
    openers: ["I've gone through the numbers in the {thing} again.", "I've updated the figures in the {thing}."],
    details: ["A couple of them looked off to me.", "Mostly small changes.", ""],
    asks: ["Could you take a look before {day}?", "Let me know if anything looks wrong."],
    replies: ["Sure, I'll check them this afternoon.", "Had a look. They look right to me now.", "Will do. I'll get back to you by {day}."],
    closings: ["Thanks!", "Great, thank you.", "Thanks, appreciate it."],
  },
};

const SCENARIO_KEYS = Object.keys(SCENARIOS);
const GREETINGS_NAMED = ["Hi {name},", "Hello {name},", "Hey {name},", "{name},", "Hi {name}!", "Morning {name},"];
const GREETINGS_PLAIN = ["Hi,", "Hello,", "Hi there,"];
const SIGN_OFFS = ["Thanks,", "Thanks!", "Best,", "Cheers,", "Talk soon,", "Thank you,", "Best regards,", "Many thanks,", "All the best,", "Kind regards,"];
const REPLY_SIGN_OFFS = ["Thanks,", "Best,", "Cheers,", "Thank you,", "Talk soon,", "Speak soon,", "Kind regards,"];
const REPLY_EXTRAS = ["", "", "", "", "Have a good day.", "Speak soon.", "Thanks!"];
// A reply that already thanks ("Thanks for letting me know") doesn't get another "Thanks!" on top.
const ALREADY_THANKS = /thank|thanks|appreciate/i;
const ROLE_ADDRESSES = /^(support|info|hello|sales|contact|admin|office|team|help|mail|noreply|no-reply|billing|accounts|hr|jobs|marketing)$/i;

type Context = Record<string, string>;

function pick<T>(list: readonly T[], rand: () => number): T {
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

/**
 * Fill {day}, {thing}… Each word is picked once per thread and kept in `ctx`, so the subject, the body and the
 * replies talk about the same thing. {day2}, {time2}, {thing2}, {item2} are a second pick, never the same as the first.
 * {Thing} (capital) gives the word with a capital letter.
 */
function fill(template: string, rand: () => number, ctx: Context): string {
  const get = (key: string): string => {
    if (ctx[key] === undefined) {
      const second = /^(\w+)2$/.exec(key);
      if (second && POOLS[second[1]]) {
        const first = get(second[1]);
        ctx[key] = pick(POOLS[second[1]].filter((v) => v !== first), rand);
      } else if (POOLS[key]) {
        const value = pick(POOLS[key], rand);
        ctx[key] = key === "progress" ? fill(value, rand, ctx) : value;
      } else {
        ctx[key] = "";
      }
    }
    return ctx[key];
  };
  return template.replace(/\{(\w+)\}/g, (_whole, key: string) => {
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    const value = get(lower);
    return key === lower ? value : capitalize(value);
  });
}

/** The thread's topic: its scenario and the words picked for it, e.g. "call-request?day=Tuesday&thing=slides". */
function encodeTopic(scenario: string, ctx: Context): string {
  const words = Object.fromEntries(Object.entries(ctx).filter(([k]) => k !== "progress"));
  const query = new URLSearchParams(words).toString();
  return query ? `${scenario}?${query}` : scenario;
}

function decodeTopic(topic: string | null): { scenario: Scenario | undefined; ctx: Context } {
  if (!topic) return { scenario: undefined, ctx: {} };
  const [key, query = ""] = topic.split("?", 2);
  return { scenario: SCENARIOS[key], ctx: Object.fromEntries(new URLSearchParams(query)) };
}

function signature(signOff: string, name: string | null): string {
  return name ? `${signOff}\n${name}` : signOff;
}

/**
 * A sign-off that doesn't repeat the text above it: no "Thanks," under a text that already thanks, and no
 * "Speak soon," under "Speak soon."
 */
function signOffFor(text: string, list: string[], rand: () => number): string {
  const said = text.toLowerCase();
  const options = list.filter((s) => {
    if (ALREADY_THANKS.test(text) && ALREADY_THANKS.test(s)) return false;
    return !said.includes(s.replace(/[,!]$/, "").toLowerCase());
  });
  return pick(options.length ? options : list, rand);
}

function greeting(name: string | null, rand: () => number): string {
  return name ? pick(GREETINGS_NAMED, rand).replace("{name}", name) : pick(GREETINGS_PLAIN, rand);
}

export type WarmupText = { topic: string; subject: string; text: string };

/** A new warm-up email from one colleague to another. */
export function newWarmupEmail(from: { name: string | null }, to: { name: string | null }, rand: () => number = Math.random): WarmupText {
  const key = pick(SCENARIO_KEYS, rand);
  const s = SCENARIOS[key];
  const ctx: Context = {};
  const opener = fill(pick(s.openers, rand), rand, ctx);
  const detail = fill(pick(s.details, rand), rand, ctx);
  const ask = fill(pick(s.asks, rand), rand, ctx);
  const subject = fill(pick(s.subjects, rand), rand, ctx);
  const first = [opener, detail].filter(Boolean).join(" ");
  // Sometimes one paragraph, sometimes the question on its own line, like people actually write.
  const body = ask ? (rand() < 0.5 ? [`${first} ${ask}`] : [first, ask]) : [first];
  const text = [greeting(to.name, rand), ...body, signature(signOffFor(body.join(" "), SIGN_OFFS, rand), from.name)].join("\n\n") + "\n";
  return { topic: encodeTopic(key, ctx), subject, text };
}

/** Whether a thread of this topic gets a closing third email ("thank you" notes and reminders don't). */
export function wantsClosing(topic: string | null): boolean {
  const { scenario } = decodeTopic(topic);
  return scenario ? scenario.closings.length > 0 : true;
}

function quoteHeader(date: Date, name: string | null, email: string, timeZone: string): string {
  // The way Gmail writes it: "On Wed, Nov 19, 2026 at 10:32 AM Sam <sam@example.com> wrote:"
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date);
  return `On ${day} at ${time} ${name ? `${name} <${email}>` : email} wrote:`;
}

const GENERIC_REPLIES = ["Thanks, got it.", "Sounds good, thanks.", "Thanks for letting me know."];
const GENERIC_CLOSINGS = ["Great, thanks!", "Perfect, thank you.", "Sounds good."];

/**
 * An answer in the same thread, with the earlier email quoted underneath like a mail app does.
 * `position` 2 is the reply to the first email; 3 is the first sender's short closing.
 */
export function warmupReply(
  p: {
    topic: string | null;
    position: 2 | 3;
    from: { name: string | null };
    to: { name: string | null; email: string };
    parent: { text: string; sentAt: Date };
    timeZone: string;
  },
  rand: () => number = Math.random,
): { text: string } {
  const { scenario, ctx } = decodeTopic(p.topic);
  const lines: string[] = [];
  if (p.position === 2) {
    if (rand() < 0.55) lines.push(greeting(p.to.name, rand));
    const answer = fill(pick(scenario?.replies ?? GENERIC_REPLIES, rand), rand, ctx);
    const extra = pick(REPLY_EXTRAS, rand);
    const said = extra && !(extra === "Thanks!" && ALREADY_THANKS.test(answer)) ? `${answer} ${extra}` : answer;
    lines.push(said);
    lines.push(signature(signOffFor(said, REPLY_SIGN_OFFS, rand), p.from.name));
  } else {
    // A closing is short: just the line and a name, the way people answer a quick reply.
    const closings = scenario?.closings.length ? scenario.closings : GENERIC_CLOSINGS;
    const line = fill(pick(closings, rand), rand, ctx);
    lines.push(p.from.name ? `${line}\n${p.from.name}` : line);
  }
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
