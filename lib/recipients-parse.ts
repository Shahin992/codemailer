// Parse typed or CSV recipient lists. Safe to import in client components.
import { normalizeKey } from "@/lib/merge";

/** sendAt: an ISO date-time chosen for this person's email; absent = automatic. */
export type ParsedRecipient = { email: string; name?: string; vars?: Record<string, string>; sendAt?: string };

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/i;

export function normalizeEmail(value: string): string {
  return value.trim().replace(/^mailto:/i, "").toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

/**
 * Accepts one recipient per line in any of these forms:
 *   jane@clinic.com
 *   Jane Doe <jane@clinic.com>
 *   jane@clinic.com, Jane Doe
 * and also several emails on one line separated by commas, semicolons or spaces.
 */
export function parseTypedList(text: string): ParsedRecipient[] {
  const out: ParsedRecipient[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const angle = /^"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(line);
    if (angle) {
      out.push({ email: angle[2], name: angle[1].trim() || undefined });
      continue;
    }
    const tokens = line.split(/[,;\t]+/).map((t) => t.trim()).filter(Boolean);
    const emailTokens = tokens.filter((t) => t.includes("@"));
    if (emailTokens.length === 1 && tokens.length > 1) {
      const name = tokens.filter((t) => !t.includes("@")).join(" ").trim();
      out.push({ email: emailTokens[0], name: name || undefined });
      continue;
    }
    const emails = line.split(/[\s,;]+/).filter((token) => token.includes("@"));
    if (!emails.length) out.push({ email: line }); // reported as invalid rather than silently dropped
    for (const token of emails) out.push({ email: token.replace(/^<|>$/g, "") });
  }
  return out;
}

export function detectEmailColumn(fields: string[], rows: Record<string, string>[]): string | undefined {
  const byName = fields.find((f) => /^e-?mail(\s*address)?$/i.test(f.trim()));
  if (byName) return byName;
  return fields.find((f) => rows.slice(0, 20).some((r) => (r[f] ?? "").includes("@")));
}

export function rowsToRecipients(fields: string[], rows: Record<string, string>[], emailColumn: string): ParsedRecipient[] {
  const nameColumn = fields.find((f) => /^(full\s*)?name$/i.test(f.trim()));
  const firstColumn = fields.find((f) => /^first[\s_-]*name$/i.test(f.trim()));
  const lastColumn = fields.find((f) => /^last[\s_-]*name$/i.test(f.trim()));
  return rows.map((row) => {
    const vars: Record<string, string> = {};
    for (const field of fields) {
      if (field === emailColumn) continue;
      const value = (row[field] ?? "").trim();
      if (value) vars[normalizeKey(field)] = value;
    }
    const name = nameColumn
      ? (row[nameColumn] ?? "").trim()
      : [firstColumn && row[firstColumn], lastColumn && row[lastColumn]].filter(Boolean).join(" ").trim();
    return { email: row[emailColumn] ?? "", name: name || undefined, vars };
  });
}

export type RecipientCheck = {
  valid: ParsedRecipient[];
  invalid: string[];
  duplicates: number;
};

/** Normalise, validate and de-duplicate a list (first occurrence wins). */
export function checkRecipients(list: ParsedRecipient[]): RecipientCheck {
  const seen = new Set<string>();
  const valid: ParsedRecipient[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const item of list) {
    const email = normalizeEmail(item.email);
    if (!isValidEmail(email)) {
      if (email) invalid.push(item.email.trim());
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    valid.push({ ...item, email });
  }
  return { valid, invalid, duplicates };
}
