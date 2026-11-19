"use client";

// Short messages that pop up at the top of the screen ("Saved", "Connection works", an error), so it's always
// clear whether something worked, even when the form's own message is scrolled out of view on a phone.

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, cn } from "@/components/ui";

type ToastTone = "success" | "danger";
type Toast = { id: number; tone: ToastTone; text: string };

const EVENT = "coldmailer:toast";

/** Show a message at the top of the screen. */
export function toast(tone: ToastTone, text: string) {
  if (typeof window === "undefined" || !text) return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { tone, text } }));
}

/** Renders the messages; put once in the page shell. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let next = 1;
    const onToast = (e: Event) => {
      const { tone, text } = (e as CustomEvent<{ tone: ToastTone; text: string }>).detail;
      const id = next++;
      setItems((list) => [...list.filter((t) => t.text !== text), { id, tone, text }].slice(-3));
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), tone === "danger" ? 7000 : 4000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:top-auto md:bottom-6 md:items-end md:px-6"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === "danger" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex w-full max-w-md animate-toast-in items-start gap-3 rounded-2xl border bg-card px-4 py-3 text-sm shadow-raised",
          )}
        >
          {t.tone === "success" ? (
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          ) : (
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          )}
          <p className="min-w-0 flex-1 leading-snug break-words">{t.text}</p>
          <button
            type="button"
            onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}
            className="-m-1 rounded-lg p-1 text-muted hover:bg-neutral-soft hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * The result of a form's server action: shown in place (as before) and as a pop-up message, each time the
 * action returns. Pass the state object the action returned ({ error } or { message }).
 */
export function ActionResult({ state, toastOnly = false }: { state: { error?: string; message?: string }; toastOnly?: boolean }) {
  const seen = useRef<object | null>(null);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.error) toast("danger", state.error);
    else if (state.message) toast("success", state.message);
  }, [state]);
  if (toastOnly) return null;
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** A message passed through the page address after a redirect (e.g. "?saved=1"), shown once as a pop-up. */
export function FlashToast({ tone, text }: { tone: ToastTone; text: string }) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast(tone, text);
  }, [tone, text]);
  return null;
}
