// Prints fresh secrets for .env. Usage: npm run keys
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const secret = (bytes = 32) => randomBytes(bytes).toString("base64url");
const vapid = webpush.generateVAPIDKeys();

console.log(`# Paste into .env (keep these private)
AUTH_SECRET=${secret()}
ENCRYPTION_KEY=${randomBytes(32).toString("hex")}
TRACKING_SECRET=${secret()}
CRON_SECRET=${secret()}
API_KEY=${secret(24)}
VAPID_PUBLIC_KEY=${vapid.publicKey}
VAPID_PRIVATE_KEY=${vapid.privateKey}`);
