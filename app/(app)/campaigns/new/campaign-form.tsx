"use client";

import { ChevronLeft, ChevronRight, Eye, FileSpreadsheet, Keyboard, RotateCcw, Send, Upload, X } from "lucide-react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { buildVars, fillFields, textToHtml } from "@/lib/merge";
import { PROVIDER_PRESETS } from "@/lib/providers";
import {
  checkRecipients,
  detectEmailColumn,
  parseTypedList,
  rowsToRecipients,
  type ParsedRecipient,
} from "@/lib/recipients-parse";
import { estimateSendingDays, toLocalInputValue, windowMinutes, type SendWindow } from "@/lib/time-window";
import type { Provider } from "@/lib/db/schema";

export type SenderOption = {
  id: string;
  email: string;
  displayName: string | null;
  provider: Provider;
  status: "active" | "paused";
  dailyLimit: number;
};

export type FollowUpInfo = {
  id: string;
  name: string;
  subject: string;
  eligible: number;
  mailboxes: string[];
  window: SendWindow;
  style: "personal" | "newsletter";
  trackOpens: boolean;
  trackClicks: boolean;
};

type CsvState = { fileName: string; fields: string[]; rows: Record<string, string>[]; emailColumn: string };

const TIMES_PER_PAGE = 20;
const DAY_MS = 24 * 60 * 60_000;

/** Most send times that fall inside any 24-hour stretch (times sorted ascending). */
function busiest24h(sorted: number[]): number {
  let most = 0;
  for (let lo = 0, hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi] - sorted[lo] >= DAY_MS) lo++;
    most = Math.max(most, hi - lo + 1);
  }
  return most;
}

const COMMON_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dhaka",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
];

function allZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return COMMON_ZONES;
  }
}

function Section({ step, title, description, children }: { step: number; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{step}</span>
            {title}
          </span>
        }
        description={description}
      />
      <div className="space-y-4 p-4 md:p-5">{children}</div>
    </Card>
  );
}

export function CampaignForm({
  senders,
  followUp,
  testEmail,
  defaults,
}: {
  senders: SenderOption[];
  followUp: FollowUpInfo | null;
  testEmail: string;
  defaults: SendWindow;
}) {
  const router = useRouter();
  const [name, setName] = useState(followUp ? `${followUp.name} – follow-up` : "");
  const [tab, setTab] = useState<"type" | "csv">("type");
  const [typed, setTyped] = useState("");
  const [csv, setCsv] = useState<CsvState | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(senders.filter((s) => s.status === "active").map((s) => s.id)));
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [bodyFormat, setBodyFormat] = useState<"text" | "html">("text");
  const [win, setWin] = useState<SendWindow>(followUp?.window ?? defaults);
  // "auto": spaced out inside the send window. "manual": a set time for every email.
  const [timing, setTiming] = useState<"auto" | "manual">("auto");
  const [firstAt, setFirstAt] = useState(""); // datetime-local value, your timezone
  const [everyMinutes, setEveryMinutes] = useState(10);
  const [timeEdits, setTimeEdits] = useState<Map<string, string>>(new Map()); // email -> datetime-local
  const [timesPage, setTimesPage] = useState(0);
  const [style, setStyle] = useState<"personal" | "newsletter">(followUp?.style ?? "personal");
  const [trackOpens, setTrackOpens] = useState(followUp?.trackOpens ?? false);
  const [trackClicks, setTrackClicks] = useState(followUp?.trackClicks ?? false);
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState(testEmail);
  const [testState, setTestState] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocus = useRef<"subject" | "body">("body");
  const zones = useMemo(allZones, []);

  const csvList = useMemo<ParsedRecipient[]>(
    () => (csv ? rowsToRecipients(csv.fields, csv.rows, csv.emailColumn) : []),
    [csv],
  );
  const check = useMemo(() => checkRecipients([...parseTypedList(typed), ...csvList]), [typed, csvList]);

  const fields = useMemo(() => {
    const keys = new Set(["name", "first_name", "email"]);
    check.valid.slice(0, 200).forEach((r) => Object.keys(r.vars ?? {}).forEach((k) => keys.add(k)));
    return [...keys];
  }, [check.valid]);

  const chosen = senders.filter((s) => selected.has(s.id) && s.status === "active");
  const capacity = chosen.reduce((sum, s) => sum + s.dailyLimit, 0);
  const total = followUp ? followUp.eligible : check.valid.length;
  const days = estimateSendingDays(total, capacity);
  let gapText = "";
  try {
    const mins = windowMinutes(win.windowStart, win.windowEnd);
    if (chosen.length) gapText = `about every ${Math.max(2, Math.round(mins / (capacity / chosen.length)))} minutes`;
  } catch {
    gapText = "";
  }

  const autoGap = chosen.length && capacity ? Math.max(2, Math.round(windowMinutes(win.windowStart, win.windowEnd) / (capacity / chosen.length))) : 10;
  const firstMs = firstAt ? new Date(firstAt).getTime() : NaN;
  const plannedTime = (index: number, email?: string): string =>
    (email && timeEdits.get(email)) || (Number.isFinite(firstMs) ? toLocalInputValue(new Date(firstMs + index * everyMinutes * 60_000)) : "");
  const followUpCapacity = followUp
    ? senders.filter((s) => followUp.mailboxes.includes(s.email) && s.status === "active").reduce((sum, s) => sum + s.dailyLimit, 0)
    : 0;
  const manualCheck = useMemo(() => {
    if (timing !== "manual") return null;
    const count = followUp ? followUp.eligible : check.valid.length;
    const times: number[] = [];
    let missing = -1;
    for (let i = 0; i < count; i++) {
      const value = plannedTime(i, followUp ? undefined : check.valid[i].email);
      const ms = value ? new Date(value).getTime() : NaN;
      if (!Number.isFinite(ms)) {
        if (missing < 0) missing = i;
        continue;
      }
      times.push(ms);
    }
    times.sort((a, b) => a - b);
    const now = Date.now();
    return {
      missing,
      first: times[0],
      last: times[times.length - 1],
      past: times.filter((t) => t < now).length,
      busiest: busiest24h(times),
    };
  }, [timing, followUp, check.valid, timeEdits, firstMs, everyMinutes]); // everything plannedTime reads

  function chooseSetTimes() {
    setTiming("manual");
    // Start 10 minutes from now (rounded up to 5), spaced like the automatic timing.
    if (!firstAt || new Date(firstAt).getTime() < Date.now()) {
      setFirstAt(toLocalInputValue(new Date(Math.ceil((Date.now() + 10 * 60_000) / 300_000) * 300_000)));
      setEveryMinutes(autoGap);
    }
  }

  function editTime(email: string, value: string | null) {
    const next = new Map(timeEdits);
    if (value === null) next.delete(email);
    else next.set(email, value);
    setTimeEdits(next);
  }

  const sample = check.valid[0] ?? { email: "jane@example.com", name: "Jane Doe" };
  const sampleVars = buildVars({ email: sample.email, name: sample.name ?? null }, sample.vars);
  const previewSubject = followUp ? `Re: ${followUp.subject}` : fillFields(subject, sampleVars);
  const previewHtml = fillFields(bodyFormat === "html" ? body : textToHtml(body), sampleVars, true);

  function insertField(key: string) {
    const token = `{{${key}}}`;
    const target = lastFocus.current === "subject" && !followUp ? subjectRef.current : bodyRef.current;
    const setter = lastFocus.current === "subject" && !followUp ? setSubject : setBody;
    if (!target) return;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    const next = target.value.slice(0, start) + token + target.value.slice(end);
    setter(next);
    requestAnimationFrame(() => {
      target.focus();
      target.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function applyRows(label: string, fieldsFound: string[], rows: Record<string, string>[]) {
    const emailColumn = detectEmailColumn(fieldsFound, rows);
    if (!emailColumn) {
      setCsvError("No email column found. Add a column named “email”.");
      setCsv(null);
      return;
    }
    setCsv({ fileName: label, fields: fieldsFound, rows, emailColumn });
  }

  function onCsv(file: File | undefined) {
    setCsvError(null);
    if (!file) return;
    if (/\.(xlsx?|numbers)$/i.test(file.name)) {
      setCsvError("Excel files aren't supported directly. In Excel use File → Save As → CSV, or paste a Google Sheets link.");
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (result) => applyRows(file.name, (result.meta.fields ?? []).filter(Boolean), result.data),
      error: (err) => setCsvError(err.message),
    });
  }

  async function importSheet() {
    setCsvError(null);
    if (!sheetUrl.trim()) return setCsvError("Paste the Google Sheets link first.");
    setSheetLoading(true);
    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sheetUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not import the sheet");
      const text = await res.text();
      const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
      applyRows("Google Sheet", (result.meta.fields ?? []).filter(Boolean), result.data);
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : String(err));
    } finally {
      setSheetLoading(false);
    }
  }

  function payload() {
    const manual = timing === "manual";
    return {
      name: name.trim(),
      subject: followUp ? undefined : subject,
      body,
      bodyFormat,
      senderIds: followUp ? undefined : [...selected],
      recipients: followUp
        ? undefined
        : manual
          ? check.valid.map((r, i) => ({ ...r, sendAt: new Date(plannedTime(i, r.email)).toISOString() }))
          : check.valid,
      schedule: manual && followUp ? { startAt: new Date(firstAt).toISOString(), everyMinutes } : undefined,
      followUpOf: followUp?.id ?? null,
      style,
      trackOpens: style === "newsletter" && trackOpens,
      trackClicks: style === "newsletter" && trackClicks,
      ...win,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!followUp && check.valid.length === 0) return setError("Add at least one valid recipient.");
    if (!followUp && chosen.length === 0) return setError("Choose at least one active mailbox.");
    if (!followUp && !subject.trim()) return setError("Write a subject.");
    if (!body.trim()) return setError("Write the email body.");
    if (manualCheck && manualCheck.missing >= 0) {
      return setError(followUp ? "Pick the time of the first email." : `Pick a send time for every email (number ${manualCheck.missing + 1} has none).`);
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the campaign");
      const skipped = (data.rejected?.length ?? 0) + (data.duplicates ?? 0);
      router.push(`/campaigns/${data.campaignId}?created=${data.accepted}&skipped=${skipped}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function sendTest() {
    setTestState(null);
    const senderId = followUp ? senders.find((s) => followUp.mailboxes.includes(s.email))?.id : chosen[0]?.id;
    if (!senderId) return setTestState({ ok: false, text: "Choose an active mailbox first." });
    setTesting(true);
    try {
      const res = await fetch("/api/campaigns/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId,
          to: testTo,
          subject: previewSubject || subject,
          body,
          bodyFormat,
          style,
          sample: { email: sample.email, name: sample.name, vars: sample.vars },
        }),
      });
      const data = await res.json();
      setTestState(res.ok ? { ok: true, text: data.message } : { ok: false, text: data.error });
    } catch (err) {
      setTestState({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  const limitTotal = followUp ? followUpCapacity : capacity;
  const timesPages = Math.max(1, Math.ceil(check.valid.length / TIMES_PER_PAGE));
  const shownPage = Math.min(timesPage, timesPages - 1);
  const timesFrom = shownPage * TIMES_PER_PAGE;
  const when = (ms: number | undefined) =>
    ms === undefined ? "—" : new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  // Only rendered after "Set the times myself" is clicked, so reading the browser's timezone and clock is safe here.
  const manualTimesPanel = timing === "manual" && (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First email at" htmlFor="firstAt" hint={`In your timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}>
          <Input id="firstAt" type="datetime-local" value={firstAt} onChange={(e) => setFirstAt(e.target.value)} required />
        </Field>
        <Field label="Then one every" htmlFor="everyMinutes" hint="Minutes between emails. 0 sends them all at once, which looks like bulk mail.">
          <div className="flex items-center gap-2">
            <Input
              id="everyMinutes"
              type="number"
              min={0}
              max={10080}
              value={everyMinutes}
              onChange={(e) => setEveryMinutes(Math.min(10080, Math.max(0, Math.round(Number(e.target.value)) || 0)))}
              className="w-28"
            />
            <span className="text-sm text-muted">minutes</span>
          </div>
        </Field>
      </div>

      {!followUp && check.valid.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between gap-2 border-b bg-neutral-soft px-3 py-2 text-xs">
            <span className="font-medium">Send time for each email</span>
            {timeEdits.size > 0 && (
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setTimeEdits(new Map())}>
                Undo {timeEdits.size} change{timeEdits.size === 1 ? "" : "s"}
              </button>
            )}
          </div>
          <ul className="divide-y">
            {check.valid.slice(timesFrom, timesFrom + TIMES_PER_PAGE).map((r, k) => {
              const i = timesFrom + k;
              const edited = timeEdits.has(r.email);
              return (
                <li key={r.email} className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="mr-2 text-xs text-muted tabular-nums">{i + 1}</span>
                    {r.email}
                  </span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="datetime-local"
                      value={plannedTime(i, r.email)}
                      onChange={(e) => editTime(r.email, e.target.value)}
                      aria-label={`Send time for ${r.email}`}
                      className={cn("h-9 w-full text-sm sm:w-auto", edited && "border-primary")}
                    />
                    <button
                      type="button"
                      onClick={() => editTime(r.email, null)}
                      title="Back to the planned time"
                      aria-label={`Undo the change for ${r.email}`}
                      className={cn("shrink-0 text-muted hover:text-fg", !edited && "invisible")}
                    >
                      <RotateCcw className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {timesPages > 1 && (
            <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs text-muted">
              <span>
                {timesFrom + 1}–{Math.min(timesFrom + TIMES_PER_PAGE, check.valid.length)} of {check.valid.length}
              </span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={shownPage === 0} onClick={() => setTimesPage(shownPage - 1)} aria-label="Previous page">
                  <ChevronLeft className="size-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={shownPage >= timesPages - 1} onClick={() => setTimesPage(shownPage + 1)} aria-label="Next page">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {followUp && <p className="text-xs text-muted">Follow-ups go out in the order the first emails were sent.</p>}

      {manualCheck && total > 0 && manualCheck.first !== undefined && (
        <Alert tone="info">
          {total} email{total === 1 ? "" : "s"} from <strong>{when(manualCheck.first)}</strong>
          {total > 1 && (
            <>
              {" "}to <strong>{when(manualCheck.last)}</strong>
            </>
          )}
          . You can still change any single email's time on the campaign page.
        </Alert>
      )}
      {manualCheck && manualCheck.past > 0 && (
        <Alert tone="warning">
          {manualCheck.past} of these times {manualCheck.past === 1 ? "has" : "have"} already passed: {manualCheck.past === 1 ? "that email goes" : "those emails go"} out
          as soon as the campaign starts.
        </Alert>
      )}
      {manualCheck && limitTotal > 0 && manualCheck.busiest > limitTotal && (
        <Alert tone="warning">
          Up to {manualCheck.busiest} emails fall within 24 hours, but the mailboxes allow {limitTotal} a day. The extra ones wait until a mailbox is
          under its limit again.
        </Alert>
      )}
    </div>
  );

  let step = 0;
  return (
    <form onSubmit={submit} className="space-y-5">
      <Card className="p-4 md:p-5">
        <Field label="Campaign name" htmlFor="name" hint="Only you see this.">
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dental clinics – October" required maxLength={200} />
        </Field>
      </Card>

      {followUp ? (
        <Section step={++step} title="Recipients and mailboxes">
          <p className="text-sm">
            <span className="font-semibold">{followUp.eligible}</span> people from “{followUp.name}” who were sent the email and haven't
            replied, bounced or unsubscribed.
          </p>
          <p className="text-sm text-muted">
            Each person gets the follow-up from the same mailbox as before ({followUp.mailboxes.join(", ") || "none"}), as a reply in the same
            thread.
          </p>
        </Section>
      ) : (
        <>
          <Section step={++step} title="Recipients" description="Type them in, upload a CSV, or both. Duplicates and blocked addresses are removed.">
            <div className="flex gap-1 rounded-lg bg-neutral-soft p-1" role="tablist">
              {(
                [
                  ["type", "Type or paste", Keyboard],
                  ["csv", "CSV or Google Sheet", FileSpreadsheet],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                    tab === key ? "bg-card shadow-sm" : "text-muted",
                  )}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>

            {tab === "type" ? (
              <Field label="Email addresses" htmlFor="typed" hint="One per line. You can also write “Jane Doe <jane@clinic.com>” or “jane@clinic.com, Jane Doe”.">
                <Textarea
                  id="typed"
                  rows={7}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={"jane@clinic.com\nDr. Smith <smith@smiledental.com>\nalex@example.com, Alex Lee"}
                  spellCheck={false}
                />
              </Field>
            ) : (
              <div className="space-y-3">
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center hover:bg-neutral-soft">
                  <Upload className="size-6 text-muted" />
                  <span className="text-sm font-medium">{csv ? csv.fileName : "Choose a CSV file"}</span>
                  <span className="text-xs text-muted">Needs an “email” column. Other columns (name, company…) become merge fields.</span>
                  <input type="file" accept=".csv,text/csv,.xlsx,.xls" className="sr-only" onChange={(e) => onCsv(e.target.files?.[0])} />
                </label>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-border" /> or import a Google Sheet <span className="h-px flex-1 bg-border" />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="url"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    aria-label="Google Sheets link"
                  />
                  <Button type="button" variant="secondary" onClick={importSheet} disabled={sheetLoading}>
                    {sheetLoading ? "Importing…" : "Import sheet"}
                  </Button>
                </div>
                <p className="text-xs text-muted">The sheet must be shared as “Anyone with the link can view”. The tab in the link is the one imported.</p>
                {csvError && <Alert tone="danger">{csvError}</Alert>}
                {csv && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Email column" htmlFor="emailColumn">
                        <Select id="emailColumn" value={csv.emailColumn} onChange={(e) => setCsv({ ...csv, emailColumn: e.target.value })} className="w-auto min-w-40">
                          {csv.fields.map((f) => (
                            <option key={f}>{f}</option>
                          ))}
                        </Select>
                      </Field>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCsv(null)}>
                        <X className="size-4" /> Remove file
                      </Button>
                    </div>
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-neutral-soft">
                          <tr>
                            {csv.fields.map((f) => (
                              <th key={f} className="px-3 py-2 font-medium whitespace-nowrap">
                                {f}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csv.rows.slice(0, 4).map((row, i) => (
                            <tr key={i} className="border-t">
                              {csv.fields.map((f) => (
                                <td key={f} className="max-w-48 truncate px-3 py-2 whitespace-nowrap">
                                  {row[f]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted">
                      {csv.rows.length} rows · showing the first {Math.min(4, csv.rows.length)}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="success">{check.valid.length} ready</Badge>
              {check.invalid.length > 0 && <Badge tone="danger">{check.invalid.length} invalid</Badge>}
              {check.duplicates > 0 && <Badge tone="warning">{check.duplicates} duplicates removed</Badge>}
              {tab === "type" && csv && <Badge>includes {csv.rows.length} from CSV</Badge>}
              {tab === "csv" && typed.trim() && <Badge>includes typed addresses</Badge>}
            </div>
            {check.invalid.length > 0 && (
              <p className="text-xs break-words text-danger">
                Not valid: {check.invalid.slice(0, 8).join(", ")}
                {check.invalid.length > 8 ? ` and ${check.invalid.length - 8} more` : ""}
              </p>
            )}
          </Section>

          <Section step={++step} title="Send from" description="Mailboxes take turns. Each one stays under its own daily limit.">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted">
                {chosen.length} selected · up to <span className="font-medium text-fg">{capacity}</span> emails a day
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected(
                    chosen.length === senders.filter((s) => s.status === "active").length
                      ? new Set()
                      : new Set(senders.filter((s) => s.status === "active").map((s) => s.id)),
                  )
                }
              >
                {chosen.length === senders.filter((s) => s.status === "active").length ? "Clear" : "Select all"}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {senders.map((s) => {
                const disabled = s.status !== "active";
                const on = selected.has(s.id) && !disabled;
                return (
                  <label
                    key={s.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      on ? "border-primary bg-primary-soft/60" : "hover:bg-neutral-soft",
                      disabled && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
                      checked={on}
                      disabled={disabled}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(s.id);
                        else next.delete(s.id);
                        setSelected(next);
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.email}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {PROVIDER_PRESETS[s.provider].label} · {s.dailyLimit}/day
                        {disabled && <Badge tone="warning">paused</Badge>}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Section>
        </>
      )}

      <Section step={++step} title="Email">
        {followUp ? (
          <Field label="Subject">
            <Input value={`Re: ${followUp.subject}`} disabled />
          </Field>
        ) : (
          <Field label="Subject" htmlFor="subject">
            <Input
              id="subject"
              ref={subjectRef}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={() => (lastFocus.current = "subject")}
              placeholder="Quick question about {{company}}"
              maxLength={300}
            />
          </Field>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-lg bg-neutral-soft p-1">
            {(["text", "html"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setBodyFormat(f)}
                className={cn("rounded-md px-3 py-1.5 text-xs font-medium", bodyFormat === f ? "bg-card shadow-sm" : "text-muted")}
              >
                {f === "text" ? "Plain text" : "HTML"}
              </button>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowPreview((v) => !v)}>
            <Eye className="size-4" /> {showPreview ? "Hide preview" : "Preview"}
          </Button>
        </div>

        <div>
          <p className="mb-1.5 text-xs text-muted">Insert a field (filled in for each person):</p>
          <div className="flex flex-wrap gap-1.5">
            {fields.map((f) => (
              <button
                key={f}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertField(f)}
                className="rounded-full border px-2.5 py-1 font-mono text-xs hover:bg-neutral-soft"
              >
                {`{{${f}}}`}
              </button>
            ))}
          </div>
        </div>

        <Field
          label="Message"
          htmlFor="body"
          hint={
            bodyFormat === "text"
              ? "Plain text lands in the inbox most often. Links become clickable automatically. Use {{name|there}} for a fallback."
              : "Paste HTML. Keep it simple: few images and links."
          }
        >
          <Textarea
            id="body"
            ref={bodyRef}
            rows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={() => (lastFocus.current = "body")}
            placeholder={"Hi {{first_name|there}},\n\nI noticed …\n\nBest,\nSarah"}
            className={cn(bodyFormat === "html" && "font-mono text-sm")}
          />
        </Field>
        <p className="text-xs text-muted">
          {style === "personal" ? "Your opt-out line and footer from Settings are added under the message." : "An unsubscribe link and your footer from Settings are added to every email."}
        </p>

        {showPreview && (
          <div className="overflow-hidden rounded-lg border">
            <div className="border-b bg-neutral-soft px-3 py-2 text-xs">
              <p>
                <span className="text-muted">To:</span> {sample.email}
              </p>
              <p className="truncate">
                <span className="text-muted">Subject:</span> <span className="font-medium">{previewSubject || "(no subject)"}</span>
              </p>
            </div>
            <iframe
              title="Email preview"
              sandbox=""
              className="h-80 w-full bg-white"
              srcDoc={`<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;margin:16px">${previewHtml}</body></html>`}
            />
          </div>
        )}
      </Section>

      <Section
        step={++step}
        title="When to send"
        description={
          timing === "auto"
            ? "Emails go out only inside this window, spaced out so they look hand-sent."
            : "Each email goes out at the time you set, inside or outside the send window. Mailbox daily limits still apply."
        }
      >
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Timing">
          {(
            [
              ["auto", "Automatic (recommended)", "Spread across the send window below, a little apart each time."],
              ["manual", "Set the times myself", "Pick when the first email goes and how far apart the rest are, then change any single time."],
            ] as const
          ).map(([value, label, help]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={timing === value}
              onClick={() => (value === "manual" ? chooseSetTimes() : setTiming("auto"))}
              className={cn(
                "rounded-lg border px-3 py-3 text-left text-sm transition-colors",
                timing === value ? "border-primary bg-primary-soft text-primary" : "hover:bg-neutral-soft",
              )}
            >
              <span className="block font-medium">{label}</span>
              <span className="mt-0.5 block text-xs opacity-80">{help}</span>
            </button>
          ))}
        </div>
        {timing === "manual" ? (
          manualTimesPanel
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Start" htmlFor="windowStart">
                <Input id="windowStart" type="time" value={win.windowStart} onChange={(e) => setWin({ ...win, windowStart: e.target.value })} required />
              </Field>
              <Field label="End" htmlFor="windowEnd">
                <Input id="windowEnd" type="time" value={win.windowEnd} onChange={(e) => setWin({ ...win, windowEnd: e.target.value })} required />
              </Field>
              <Field label="Recipients' timezone" htmlFor="timezone">
                <Input id="timezone" list="timezones" value={win.timezone} onChange={(e) => setWin({ ...win, timezone: e.target.value })} required />
                <datalist id="timezones">
                  {zones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </Field>
              <div className="flex items-end pb-1">
                <Checkbox label="Weekdays only" checked={win.weekdaysOnly} onChange={(e) => setWin({ ...win, weekdaysOnly: e.target.checked })} />
              </div>
            </div>
            <Alert tone="info">
              {total > 0 && capacity > 0 ? (
                <>
                  {total} emails at up to {capacity} a day: about <strong>{days} sending day{days === 1 ? "" : "s"}</strong>
                  {win.weekdaysOnly ? " (weekdays)" : ""}. Each mailbox sends {gapText}, with a little random variation.
                </>
              ) : (
                "Add recipients and choose mailboxes to see how long this will take."
              )}
            </Alert>
          </>
        )}
      </Section>

      <Section step={++step} title="Email style" description="Decides whether Gmail treats it as a personal email or as a mailing.">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          {(
            [
              ["personal", "Personal (recommended)", "Plain text like a one-to-one email. People opt out by replying “no”. Best chance of the Primary inbox."],
              ["newsletter", "Newsletter", "HTML with an unsubscribe link and one-click unsubscribe header; open/click tracking available. Gmail usually files it under Promotions."],
            ] as const
          ).map(([value, label, help]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={style === value}
              onClick={() => setStyle(value)}
              className={cn(
                "rounded-lg border px-3 py-3 text-left text-sm transition-colors",
                style === value ? "border-primary bg-primary-soft text-primary" : "hover:bg-neutral-soft",
              )}
            >
              <span className="block font-medium">{label}</span>
              <span className="mt-0.5 block text-xs opacity-80">{help}</span>
            </button>
          ))}
        </div>
        {style === "personal" ? (
          <p className="text-xs text-muted">
            Ends with your opt-out line and footer from Settings. Replies like “no”, “stop” or “unsubscribe” put the person on the do-not-send list automatically.
            {bodyFormat === "html" && " Tip: write the message as plain text; HTML emails look less personal."}
          </p>
        ) : (
          <>
            <Checkbox label="Track opens" description="Adds an invisible image. Apple Mail opens every email automatically, so counts run high." checked={trackOpens} onChange={(e) => setTrackOpens(e.target.checked)} />
            <Checkbox label="Track link clicks" description="Links pass through this app before going to the real page." checked={trackClicks} onChange={(e) => setTrackClicks(e.target.checked)} />
          </>
        )}
      </Section>

      <Card className="space-y-3 p-4 md:p-5">
        <p className="text-sm font-medium">Send yourself a test first</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@yourdomain.com" aria-label="Test address" />
          <Button type="button" variant="secondary" onClick={sendTest} disabled={testing || !body.trim()}>
            <Send className="size-4" /> {testing ? "Sending…" : "Send test"}
          </Button>
        </div>
        {testState && <Alert tone={testState.ok ? "success" : "danger"}>{testState.text}</Alert>}
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : followUp ? `Start follow-up (${total})` : `Start campaign${total ? ` (${total})` : ""}`}
        </Button>
      </div>
    </form>
  );
}
