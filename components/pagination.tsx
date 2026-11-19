import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { PageSizeSelect } from "@/components/page-size-select";
import { cn } from "@/components/ui";
import { listHref, pageNumbers, type PageInfo } from "@/lib/pagination";

type Search = Record<string, string | string[] | undefined>;

const linkBase = "inline-flex h-10 min-w-10 items-center justify-center rounded-xl px-2 text-sm font-medium transition-colors md:h-9 md:min-w-9";

/** "Showing 26–50 of 1,234" with page links and a page-size choice. Filters in the URL are kept. */
export function Pagination({ info, path, search, noun = "results", className }: { info: PageInfo; path: string; search: Search; noun?: string; className?: string }) {
  if (info.total === 0) return null;
  const href = (page: number) => listHref(path, search, { page });
  const prev = info.page > 1 ? href(info.page - 1) : null;
  const next = info.page < info.totalPages ? href(info.page + 1) : null;

  return (
    <div className={cn("flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5", className)}>
      <p className="text-xs text-muted">
        {info.totalPages > 1 ? (
          <>
            Showing <span className="font-medium text-fg tabular-nums">{info.from.toLocaleString()}</span>–
            <span className="font-medium text-fg tabular-nums">{info.to.toLocaleString()}</span> of{" "}
            <span className="font-medium text-fg tabular-nums">{info.total.toLocaleString()}</span> {noun}
          </>
        ) : (
          <>
            <span className="font-medium text-fg tabular-nums">{info.total.toLocaleString()}</span> {noun}
          </>
        )}
      </p>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <PageSizeSelect value={info.pageSize} />
        {info.totalPages > 1 && (
          <nav aria-label="Pages" className="flex items-center gap-1">
            {prev ? (
              <Link href={prev} className={cn(linkBase, "border hover:bg-neutral-soft")} aria-label="Previous page" scroll={false}>
                <ChevronLeft className="size-4" />
              </Link>
            ) : (
              <span className={cn(linkBase, "border opacity-40")} aria-hidden>
                <ChevronLeft className="size-4" />
              </span>
            )}
            {/* Phones: "3 / 12"; larger screens: page numbers */}
            <span className="px-2 text-sm tabular-nums sm:hidden">
              {info.page} / {info.totalPages}
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              {pageNumbers(info.page, info.totalPages).map((p, i) =>
                p === null ? (
                  <span key={`gap-${i}`} className="px-1 text-muted">
                    …
                  </span>
                ) : (
                  <Link
                    key={p}
                    href={href(p)}
                    scroll={false}
                    aria-current={p === info.page ? "page" : undefined}
                    className={cn(linkBase, p === info.page ? "bg-primary text-primary-fg" : "hover:bg-neutral-soft")}
                  >
                    {p}
                  </Link>
                ),
              )}
            </span>
            {next ? (
              <Link href={next} className={cn(linkBase, "border hover:bg-neutral-soft")} aria-label="Next page" scroll={false}>
                <ChevronRight className="size-4" />
              </Link>
            ) : (
              <span className={cn(linkBase, "border opacity-40")} aria-hidden>
                <ChevronRight className="size-4" />
              </span>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}

/** A search box that submits as a GET form, so the query lives in the URL and paging keeps it. */
export function ListSearch({ name = "q", value, placeholder, hidden }: { name?: string; value: string; placeholder: string; hidden?: Record<string, string | undefined> }) {
  return (
    <form className="relative flex gap-2" role="search">
      {Object.entries(hidden ?? {}).map(([key, v]) => (v ? <input key={key} type="hidden" name={key} value={v} /> : null))}
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        name={name}
        type="search"
        defaultValue={value}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        className="h-12 w-full rounded-xl border bg-card pr-3 pl-10 text-fg shadow-[inset_0_1px_1px_rgb(15_23_42/0.03)] transition-[border-color,box-shadow] placeholder:text-muted/70 focus:border-primary focus:ring-4 focus:ring-primary/15 focus:outline-none md:h-10"
      />
      <button
        type="submit"
        className="h-12 shrink-0 rounded-xl border bg-card px-4 text-sm font-semibold shadow-card transition-colors hover:bg-neutral-soft active:scale-[0.98] md:h-10"
      >
        Search
      </button>
    </form>
  );
}

/** Filter chips (All / Active / …) that keep the search and reset to page 1. */
export function FilterChips({
  path,
  search,
  param,
  options,
}: {
  path: string;
  search: Search;
  param: string;
  options: { value?: string; label: string; count?: number }[];
}) {
  const current = (Array.isArray(search[param]) ? search[param]?.[0] : search[param]) as string | undefined;
  // One row that scrolls sideways on a phone (no second line of chips), wrapping on wider screens.
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
      {options.map((o) => {
        const active = (current ?? "") === (o.value ?? "");
        return (
          <Link
            key={o.label}
            href={listHref(path, search, { [param]: o.value, page: 1 })}
            scroll={false}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors md:h-8 md:text-xs",
              active ? "border-primary bg-primary text-primary-fg shadow-card" : "bg-card text-muted hover:bg-neutral-soft hover:text-fg",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn("ml-1.5 tabular-nums", active ? "opacity-80" : "opacity-70")}>{o.count.toLocaleString()}</span>}
          </Link>
        );
      })}
    </div>
  );
}
