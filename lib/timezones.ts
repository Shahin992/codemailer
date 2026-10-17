// Timezone choices for the pickers. Pure functions, safe to import in client components.
// The option lists are built on the server and passed to the page, so the browser's own
// timezone data can't make the server and browser render different lists.

import { isValidTimeZone, zoneOffsetMinutes } from "@/lib/time-window";

export type TimezoneOption = { value: string; label: string };
export type TimezoneGroup = { label: string; options: TimezoneOption[] };

/** The zones most campaigns use, with the names people know them by. */
const POPULAR: [zone: string, name: string][] = [
  ["Pacific/Honolulu", "Hawaii (Honolulu)"],
  ["America/Anchorage", "Alaska (Anchorage)"],
  ["America/Los_Angeles", "US Pacific (Los Angeles)"],
  ["America/Phoenix", "Arizona (Phoenix), no daylight saving"],
  ["America/Denver", "US Mountain (Denver)"],
  ["America/Chicago", "US Central (Chicago)"],
  ["America/New_York", "US Eastern (New York)"],
  ["America/Toronto", "Canada Eastern (Toronto)"],
  ["America/Halifax", "Canada Atlantic (Halifax)"],
  ["UTC", "UTC"],
  ["Europe/London", "UK (London)"],
  ["Europe/Berlin", "Central Europe (Berlin, Paris)"],
  ["Asia/Dubai", "UAE (Dubai)"],
  ["Asia/Karachi", "Pakistan (Karachi)"],
  ["Asia/Kolkata", "India (Kolkata)"],
  ["Asia/Dhaka", "Bangladesh (Dhaka)"],
  ["Asia/Singapore", "Singapore"],
  ["Australia/Sydney", "Australia Eastern (Sydney)"],
];

const POPULAR_NAMES = new Map(POPULAR);

// Some engines still list old names; show the current ones.
const RENAMED: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Godthab": "America/Nuuk",
};

/** "UTC−7", "UTC+5:30", "UTC" */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? "−" : "+"}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires, Argentina" */
function cityName(zone: string): string {
  const parts = zone.split("/").slice(1).map((p) => p.replace(/_/g, " "));
  if (!parts.length) return zone;
  return parts.length > 1 ? `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(", ")}` : parts[0];
}

/** A short name for a zone: "Arizona (Phoenix)", "Buenos Aires, Argentina", "UTC". */
export function timezoneName(zone: string): string {
  const popular = POPULAR_NAMES.get(zone);
  if (popular) return popular.replace(/, no daylight saving$/, "");
  return zone.includes("/") ? cityName(zone) : zone;
}

function allZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return POPULAR.map(([z]) => z);
  }
}

/**
 * Every timezone, grouped for a <select>: the popular ones first (west to east), then each region A–Z.
 * Each label shows the current UTC offset. `current` is always included, even if it's an old name.
 */
export function timezoneGroups(current?: string, now = new Date()): TimezoneGroup[] {
  const option = (value: string, name: string): TimezoneOption => {
    const offset = formatOffset(zoneOffsetMinutes(now, value));
    return { value, label: name === offset ? name : `${name} · ${offset}` };
  };
  const popular = POPULAR.filter(([z]) => isValidTimeZone(z)).map(([z, name]) => option(z, name));

  const regions = new Map<string, TimezoneOption[]>();
  const seen = new Set<string>();
  for (const listed of allZones()) {
    const zone = RENAMED[listed] && isValidTimeZone(RENAMED[listed]) ? RENAMED[listed] : listed;
    if (seen.has(zone) || !zone.includes("/")) continue;
    seen.add(zone);
    const region = zone.split("/")[0];
    if (!regions.has(region)) regions.set(region, []);
    regions.get(region)!.push(option(zone, cityName(zone)));
  }

  const groups: TimezoneGroup[] = [{ label: "Popular", options: popular }];
  if (current && isValidTimeZone(current) && !seen.has(current) && !POPULAR_NAMES.has(current)) {
    groups.push({ label: "Saved", options: [option(current, timezoneName(current))] });
  }
  for (const [region, options] of [...regions].sort(([a], [b]) => a.localeCompare(b))) {
    groups.push({ label: region, options: options.sort((a, b) => a.label.localeCompare(b.label)) });
  }
  return groups;
}
