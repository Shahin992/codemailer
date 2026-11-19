// Loading screens: grey shapes in the layout of the page that's opening, shown the moment a link is tapped
// (used by the loading.tsx files). They say "this is loading" instead of a frozen screen.
import { Skeleton } from "@/components/ui";

function Header({ action = true, description = true }: { action?: boolean; description?: boolean }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4 md:mb-6">
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-7 w-40" />
        {description && <Skeleton className="h-3.5 w-64 max-w-full" />}
      </div>
      {action && <Skeleton className="h-10 w-28 rounded-xl" />}
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border bg-card shadow-card ${className}`}>{children}</div>;
}

function Rows({ count = 6, avatar = false }: { count?: number; avatar?: boolean }) {
  return (
    <Panel className="divide-y">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-4 md:px-5">
          {avatar && <Skeleton className="size-9 shrink-0 rounded-full" />}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex justify-between gap-4">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-14" />
            </div>
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </Panel>
  );
}

function Tiles({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Panel key={i} className="space-y-2.5 p-4">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-7 w-12" />
          <Skeleton className="h-3 w-24" />
        </Panel>
      ))}
    </div>
  );
}

function Status() {
  return <span className="sr-only">Loading…</span>;
}

/** A list page: title, search, filter chips and rows. */
export function ListSkeleton({ avatar = false, filters = true }: { avatar?: boolean; filters?: boolean }) {
  return (
    <div aria-busy="true">
      <Status />
      <Header />
      {filters && (
        <div className="mb-4 space-y-3">
          <Skeleton className="h-12 w-full rounded-xl md:h-10" />
          <div className="flex gap-2">
            {["w-12", "w-20", "w-16", "w-24"].map((w) => (
              <Skeleton key={w} className={`h-8 rounded-full ${w}`} />
            ))}
          </div>
        </div>
      )}
      <Rows avatar={avatar} />
    </div>
  );
}

/** The dashboard: title, number tiles and two lists. */
export function DashboardSkeleton() {
  return (
    <div aria-busy="true">
      <Status />
      <Header description={false} />
      <Tiles />
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Rows count={4} />
        <Rows count={4} />
      </div>
    </div>
  );
}

/** A detail page: back link, title, a summary panel and a few sections. */
export function DetailSkeleton({ tiles = false }: { tiles?: boolean }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5" aria-busy="true">
      <Status />
      <Skeleton className="h-4 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-3/5" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>
      {tiles && <Tiles />}
      {[0, 1].map((i) => (
        <Panel key={i} className="space-y-3 p-4 md:p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-3/5" />
        </Panel>
      ))}
    </div>
  );
}

/** A form page: title and labelled fields. */
export function FormSkeleton() {
  return (
    <div className="mx-auto max-w-3xl" aria-busy="true">
      <Status />
      <Header action={false} />
      <Panel className="space-y-5 p-4 md:p-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-12 w-full rounded-xl md:h-10" />
          </div>
        ))}
        <Skeleton className="ml-auto h-12 w-36 rounded-xl md:h-10" />
      </Panel>
    </div>
  );
}

/** A conversation: subject, then emails folded to a line with the latest one open. */
export function ConversationSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
      <Status />
      <Skeleton className="h-4 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-3/4" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </div>
      <Panel className="divide-y">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-3 px-4 py-3.5">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex justify-between gap-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-3.5 w-3/4" />
            </div>
          </div>
        ))}
        <div className="space-y-3 px-4 py-4">
          <div className="flex gap-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </Panel>
    </div>
  );
}
