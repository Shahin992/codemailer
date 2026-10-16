"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PAGE_SIZES } from "@/lib/pagination";

/** Rows per page. Changing it goes back to page 1 and keeps the other filters. */
export function PageSizeSelect({ value }: { value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <select
      aria-label="Rows per page"
      value={value}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("size", e.target.value);
        params.delete("page");
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      }}
      className="h-9 rounded-lg border bg-card px-2 text-sm text-fg"
    >
      {PAGE_SIZES.map((size) => (
        <option key={size} value={size}>
          {size} / page
        </option>
      ))}
    </select>
  );
}
