"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Checkbox, Field, Input, buttonClass, cn } from "@/components/ui";
import { LOGO_MAX_BYTES, LOGO_MAX_WIDTH, LOGO_MIN_WIDTH, LOGO_TYPES } from "@/lib/logo-limits";

export type LogoInfo = { url: string; bytes: number; width: number; height: number; missing: boolean };

/**
 * Upload, replace or remove the logo shown with the email footer, with a preview of how it sits above the
 * footer text. The file is uploaded straight away; its width and the personal-style switch are saved with the form.
 */
export function LogoField({
  logo,
  displayWidth,
  inPersonal,
  footerText,
}: {
  logo: LogoInfo | null;
  displayWidth: number;
  inPersonal: boolean;
  footerText: string;
}) {
  const router = useRouter();
  const [width, setWidth] = useState(displayWidth);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setError("Use a PNG, JPG or GIF image. Most email apps can't show SVG or WebP.");
    if (file.size > LOGO_MAX_BYTES) return setError(`This image is ${(file.size / 1024 / 1024).toFixed(1)} MB; the logo can be up to 1 MB.`);
    setBusy("upload");
    try {
      const form = new FormData();
      form.append("logo", file);
      const res = await fetch("/api/settings/logo", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status}).`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Remove the logo? Emails will go out without it.")) return;
    setError(null);
    setBusy("remove");
    try {
      const res = await fetch("/api/settings/logo", { method: "DELETE" });
      if (!res.ok) throw new Error(`Could not remove it (${res.status}).`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const shown = logo ? Math.min(Math.max(width || 0, LOGO_MIN_WIDTH), LOGO_MAX_WIDTH, logo.width) : 0;
  const footerLines = footerText.trim();

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Logo</p>
        <p className="text-xs text-muted">
          Shown above the footer text, like an email signature, and embedded in each email so it shows without “load images”. PNG, JPG or GIF up to 1
          MB; under 100 KB is best, since every email carries a copy.
        </p>
      </div>

      {/* How it sits under an email (emails have a white background whatever the app's theme). */}
      <div className="rounded-lg border bg-white p-4 text-[#222]">
        {logo && !logo.missing ? (
          <img src={logo.url} alt="Your logo" width={shown} style={{ width: shown, maxWidth: "100%", height: "auto" }} className="block" />
        ) : (
          <p className="text-sm text-[#888]">{logo?.missing ? "The logo file is missing on the server. Upload it again." : "No logo yet."}</p>
        )}
        {footerLines && <p className="mt-3 text-xs leading-snug whitespace-pre-line text-[#888]">{footerLines}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className={cn(buttonClass("secondary", "sm"), "cursor-pointer", busy && "pointer-events-none opacity-50")}>
          <ImageUp className="size-4" />
          {busy === "upload" ? "Uploading…" : logo ? "Replace logo" : "Upload logo"}
          <input
            type="file"
            accept={LOGO_TYPES.join(",")}
            className="sr-only"
            disabled={Boolean(busy)}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = ""; // choosing the same file again still uploads
            }}
          />
        </label>
        {logo && (
          <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={Boolean(busy)}>
            <Trash2 className="size-4" /> {busy === "remove" ? "Removing…" : "Remove"}
          </Button>
        )}
        {logo && !logo.missing && (
          <span className="text-xs text-muted">
            {logo.width}×{logo.height} px · {Math.max(1, Math.round(logo.bytes / 1024))} KB
          </span>
        )}
      </div>
      {logo && logo.bytes > 200 * 1024 && (
        <Alert tone="warning">This logo is {Math.round(logo.bytes / 1024)} KB. Every email carries a copy; a smaller file (under 100 KB) sends faster and looks less like a mailing.</Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Width in emails" htmlFor="logoDisplayWidth" hint={`${LOGO_MIN_WIDTH}–${LOGO_MAX_WIDTH} pixels`}>
          <Input
            id="logoDisplayWidth"
            name="logoDisplayWidth"
            type="number"
            min={LOGO_MIN_WIDTH}
            max={LOGO_MAX_WIDTH}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            required
          />
        </Field>
      </div>
      <Checkbox
        name="logoInPersonal"
        label="Also in personal-style emails"
        description="They then go out as simple HTML instead of plain text. Images can make Gmail file cold emails under Promotions; turn this off for the best chance of the Primary inbox."
        defaultChecked={inPersonal}
      />
    </div>
  );
}
