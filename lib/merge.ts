// {{field}} and {{field|fallback}} merge fields. Safe to import in client components.

const FIELD = /\{\{\s*([a-zA-Z0-9_.-]+)\s*(?:\|([^}]*))?\}\}/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function buildVars(
  recipient: { email: string; name?: string | null },
  extra?: Record<string, string> | null,
): Record<string, string> {
  const name = (recipient.name ?? "").trim();
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(extra ?? {})) vars[normalizeKey(key)] = String(value ?? "");
  vars.email = recipient.email;
  vars.name = name || vars.name || "";
  vars.first_name = vars.first_name || name.split(/\s+/)[0] || "";
  return vars;
}

export function fillFields(template: string, vars: Record<string, string>, escape = false): string {
  return template.replace(FIELD, (_match, key: string, fallback: string | undefined) => {
    const raw = vars[normalizeKey(key)];
    const value = raw && raw.trim() ? raw : (fallback ?? "").trim();
    return escape ? escapeHtml(value) : value;
  });
}

export function findFields(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(FIELD)) found.add(normalizeKey(m[1]));
  return [...found];
}

/** Plain text to simple HTML: paragraphs, line breaks and clickable links. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((para) => {
      const escaped = escapeHtml(para).replace(
        /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g,
        (url) => `<a href="${url}">${url}</a>`,
      );
      return `<p>${escaped.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}
