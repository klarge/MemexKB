import { useState } from "react";

export const CONTENT_PAGE_SIZE = 20;

/** Keep each collection's display window independent of its cached data. */
export function useVisibleItems<T>(items: readonly T[], resetKey: string) {
  const [window, setWindow] = useState({ key: resetKey, count: CONTENT_PAGE_SIZE });
  const count = window.key === resetKey ? window.count : CONTENT_PAGE_SIZE;
  if (window.key !== resetKey) {
    setWindow({ key: resetKey, count: CONTENT_PAGE_SIZE });
  }
  return {
    items: items.slice(0, count),
    hasMore: items.length > count,
    loadMore: () => setWindow(previous => ({
      key: resetKey,
      count: (previous.key === resetKey ? previous.count : CONTENT_PAGE_SIZE) + CONTENT_PAGE_SIZE,
    })),
  };
}