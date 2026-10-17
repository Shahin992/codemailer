import path from "node:path";

/** Where uploaded and received files live (reply attachments, the email logo). In Docker: the "storage" volume. */
export function storageDir(): string {
  return process.env.STORAGE_DIR || path.join(process.cwd(), "storage");
}

/** Absolute path of a file stored under storageDir(), or null if `relative` would point outside it. */
export function storedPath(relative: string): string | null {
  // Runtime paths, not files to bundle: tell the build not to trace them.
  const root = path.resolve(/*turbopackIgnore: true*/ storageDir());
  const file = path.resolve(/*turbopackIgnore: true*/ root, relative);
  return file.startsWith(root + path.sep) ? file : null;
}
