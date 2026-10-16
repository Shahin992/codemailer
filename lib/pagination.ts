// Offset pagination shared by the pages and the API. Safe to import in client components.

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_API_PAGE_SIZE = 200;

export type PageParams = { page: number; pageSize: number; offset: number };

export type PageInfo = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  from: number; // 1-based index of the first row on this page (0 when empty)
  to: number;
};

function toInt(value: string | string[] | null | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** Page and page size from the URL (`?page=3&size=50`). Dashboard pages only allow the sizes in PAGE_SIZES. */
export function readPage(
  params: { page?: string | string[]; size?: string | string[] },
  defaultSize = DEFAULT_PAGE_SIZE,
): PageParams {
  const size = toInt(params.size);
  const pageSize = size && (PAGE_SIZES as readonly number[]).includes(size) ? size : defaultSize;
  const page = toInt(params.page) ?? 1;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Page and page size for the API (`?page=2&page_size=100`), any size up to MAX_API_PAGE_SIZE. */
export function readApiPage(url: URL, defaultSize = 50): PageParams {
  const pageSize = Math.min(toInt(url.searchParams.get("page_size")) ?? defaultSize, MAX_API_PAGE_SIZE);
  const page = toInt(url.searchParams.get("page")) ?? 1;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** When someone asks for a page past the end (rows deleted, bookmark), show the last page instead. */
export function clampPage(params: PageParams, total: number): PageParams {
  const lastPage = Math.max(1, Math.ceil(total / params.pageSize));
  if (params.page <= lastPage) return params;
  return { ...params, page: lastPage, offset: (lastPage - 1) * params.pageSize };
}

export function pageInfo(params: PageParams, total: number, rowsOnPage: number): PageInfo {
  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    from: rowsOnPage ? params.offset + 1 : 0,
    to: params.offset + rowsOnPage,
  };
}

/** The pagination block every API list returns. */
export function apiPagination(info: PageInfo) {
  return {
    page: info.page,
    page_size: info.pageSize,
    total: info.total,
    total_pages: info.totalPages,
    has_more: info.page < info.totalPages,
  };
}

/** Page numbers to show: 1 … 4 5 6 … 20 (null marks a gap). */
export function pageNumbers(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}

/** A link to the same list with some query parameters changed (others, like filters and search, are kept). */
export function listHref(path: string, current: Record<string, string | string[] | undefined>, changes: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined && v !== "") params.set(key, v);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === "" || (key === "page" && Number(value) === 1)) params.delete(key);
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
