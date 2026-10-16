import { resolveMx, resolveTxt } from "node:dns/promises";

export type DnsCheck = { domain: string; mx: boolean; spf: boolean; dmarc: boolean };

const FREE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

async function txt(name: string): Promise<string[]> {
  try {
    return (await resolveTxt(name)).map((parts) => parts.join(""));
  } catch {
    return [];
  }
}

/** Quick look at the records that decide whether mail from this domain lands in the inbox. */
export async function checkDomainDns(domain: string): Promise<DnsCheck | null> {
  if (FREE_DOMAINS.has(domain)) return null; // Google handles these
  const [mx, root, dmarc] = await Promise.all([
    resolveMx(domain).then((r) => r.length > 0).catch(() => false),
    txt(domain),
    txt(`_dmarc.${domain}`),
  ]);
  return {
    domain,
    mx,
    spf: root.some((r) => r.toLowerCase().startsWith("v=spf1")),
    dmarc: dmarc.some((r) => r.toLowerCase().startsWith("v=dmarc1")),
  };
}
