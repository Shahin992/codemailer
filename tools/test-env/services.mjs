// Local test services: Postgres (54329), SMTP sink (2525), IMAP mock (1143), and one IMAP mock per
// warm-up test mailbox (1144-1147; 1147 looks like Gmail: [Gmail]/Spam and Gmail's label extension).
// Every message the SMTP sink receives is saved to ./outbox/<n>.eml for inspection. Mail addressed to a
// warm-up test mailbox is also delivered to that mailbox's own IMAP server: to INBOX, except every
// WARMUP_JUNK_EVERY-th email to each one (default 3; 0 = never), which goes to its spam folder.
import EmbeddedPostgres from "embedded-postgres";
import { SMTPServer } from "smtp-server";
import hoodiecrow from "hoodiecrow-imap";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outbox = path.join(here, "outbox");
fs.mkdirSync(outbox, { recursive: true });

const pgDir = path.join(here, "pgdata");
const pg = new EmbeddedPostgres({ databaseDir: pgDir, user: "email", password: "email", port: 54329, persistent: true });
if (!fs.existsSync(path.join(pgDir, "PG_VERSION"))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("email_sender");
} catch {
  /* already exists */
}
console.log("postgres ready on 54329");

// Warm-up test mailboxes: each has its own IMAP server with INBOX, Sent and Junk (contents reset on restart).
const WARMUP_MAILBOXES = [
  { email: "anna@north.test", port: 1144 },
  { email: "ben@north.test", port: 1145 },
  { email: "cara@south.test", port: 1146 },
  { email: "dana@gmail-test.test", port: 1147, gmail: true }, // a warm-up partner like a Gmail account
];
const junkEvery = Number(process.env.WARMUP_JUNK_EVERY ?? 3);
const warmup = new Map();
for (const box of WARMUP_MAILBOXES) {
  const folders = box.gmail
    ? {
        "[Gmail]": {
          flags: ["\\Noselect"],
          folders: {
            "All Mail": { "special-use": "\\All" },
            "Sent Mail": { "special-use": "\\Sent" },
            Spam: { "special-use": "\\Junk" },
            Starred: { "special-use": "\\Flagged" },
            Important: { "special-use": "\\Important" },
          },
        },
      }
    : { Sent: { "special-use": "\\Sent" }, Junk: { "special-use": "\\Junk" } };
  const server = hoodiecrow({
    plugins: ["SPECIAL-USE", "UIDPLUS", "ID", "IDLE", "MOVE", ...(box.gmail ? ["X-GM-EXT-1"] : [])],
    users: { [box.email]: { password: "test-app-password" } },
    storage: { INBOX: { messages: [] }, "": { separator: "/", folders } },
  });
  server.listen(box.port, () => console.log(`imap mock for ${box.email} ready on ${box.port}`));
  warmup.set(box.email, { server, received: 0, spam: box.gmail ? "[Gmail]/Spam" : "Junk" });
}

function deliver(address, raw) {
  const box = warmup.get(address.toLowerCase());
  if (!box) return;
  box.received++;
  const folder = junkEvery > 0 && box.received % junkEvery === 0 ? box.spam : "INBOX";
  box.server.appendMessage(folder, [], new Date(), raw);
  console.log(`delivered to ${address} ${folder}`);
}

let n = fs.readdirSync(outbox).length;
const smtp = new SMTPServer({
  authOptional: false,
  allowInsecureAuth: true,
  disabledCommands: ["STARTTLS"],
  onAuth(auth, _session, cb) {
    console.log(`smtp auth: ${auth.username}`);
    if (auth.password === "wrong-password") return cb(new Error("Invalid login"));
    cb(null, { user: auth.username });
  },
  onRcptTo(address, _session, cb) {
    // Simulate a recipient the server rejects outright.
    if (address.address.startsWith("reject-")) {
      const err = new Error("5.1.1 User unknown");
      err.responseCode = 550;
      return cb(err);
    }
    cb();
  },
  onData(stream, session, cb) {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => {
      n++;
      const raw = Buffer.concat(chunks);
      fs.writeFileSync(path.join(outbox, `${String(n).padStart(4, "0")}.eml`), raw);
      console.log(`smtp: ${session.envelope.mailFrom.address} -> ${session.envelope.rcptTo.map((r) => r.address).join(",")}`);
      for (const r of session.envelope.rcptTo) deliver(r.address, raw);
      cb();
    });
  },
});
smtp.listen(2525, "127.0.0.1", () => console.log("smtp sink ready on 2525"));

const users = {};
for (const u of ["support@acme.test", "contact@acme.test", "sales.acme@gmail-test.test"]) users[u] = { password: "test-app-password" };
const imap = hoodiecrow({
  plugins: ["SPECIAL-USE", "UIDPLUS", "ID", "IDLE"],
  users,
  storage: {
    INBOX: { messages: [{ raw: "From: old@example.com\r\nTo: support@acme.test\r\nSubject: Old support mail\r\nMessage-ID: <old-1@example.com>\r\n\r\nThis existed before the mailbox was connected." }] },
    "": {
      separator: "/",
      folders: {
        Sent: { "special-use": "\\Sent" },
        Junk: { "special-use": "\\Junk" },
      },
    },
  },
});
imap.listen(1143, () => console.log("imap mock ready on 1143"));

const stop = async () => {
  await pg.stop().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
