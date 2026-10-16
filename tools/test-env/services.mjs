// Local test services: Postgres (54329), SMTP sink (2525), IMAP mock (1143).
// Every message the SMTP sink receives is saved to ./outbox/<n>.eml for inspection.
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
      fs.writeFileSync(path.join(outbox, `${String(n).padStart(4, "0")}.eml`), Buffer.concat(chunks));
      console.log(`smtp: ${session.envelope.mailFrom.address} -> ${session.envelope.rcptTo.map((r) => r.address).join(",")}`);
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
