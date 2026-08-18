import { useCallback, useEffect, useRef, useState } from "react";

export interface WikilinkSuggestion {
  title: string;
  slug: string;
}

/**
 * Returns the partial search query if the cursor is sitting inside an unclosed
 * [[…]] fragment (i.e. there is an opening [[ before the cursor with no ]]
 * closing it yet). Returns null otherwise.
 */
export function getWikilinkQueryAtCursor(value: string, cursor: number): string | null {
  const before = value.slice(0, cursor);
  const lastOpen = before.lastIndexOf("[[");
  if (lastOpen === -1) return null;
  const afterOpen = before.slice(lastOpen + 2);
  // Already closed before the cursor — not inside an active fragment
  if (afterOpen.includes("]]")) return null;
  return afterOpen;
}

/**
 * Replaces the in-progress [[fragment with [[title]] at the cursor position.
 * Returns the new value string and the cursor position that should follow.
 */
export function insertWikilink(
  value: string,
  cursor: number,
  title: string,
): { newValue: string; newCursor: number } {
  const before = value.slice(0, cursor);
  const lastOpen = before.lastIndexOf("[[");
  if (lastOpen === -1) return { newValue: value, newCursor: cursor };
  const inserted = `[[${title}]]`;
  const newValue = value.slice(0, lastOpen) + inserted + value.slice(cursor);
  const newCursor = lastOpen + inserted.length;
  return { newValue, newCursor };
}

export interface UseWikilinkAutocompleteResult {
  isOpen: boolean;
  items: WikilinkSuggestion[];
  selectedIndex: number;
  /** Call on every input change event with the new value and cursor position. */
  onInputChange: (value: string, cursor: number) => void;
  /**
   * Call in the input's onKeyDown. Returns true when the key was consumed
   * (ArrowUp / ArrowDown / Escape); the caller should stop propagation.
   * Does NOT handle Enter — the caller does that by reading selectedIndex.
   */
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => boolean;
  /** Close the dropdown, cancel any pending request, and invalidate in-flight ones. */
  dismiss: () => void;
}

export function useWikilinkAutocomplete(): UseWikilinkAutocompleteResult {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<WikilinkSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // AbortController for the most recent in-flight fetch.
  const abortRef = useRef<AbortController | null>(null);
  // Monotonically increasing token. A response is only applied when its token
  // still matches the current token at the time the response resolves — this
  // discards stale responses that arrive after dismiss() or a query change.
  const tokenRef = useRef(0);

  // Cancel everything on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  const runSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Stamp this search with a new token before the debounce fires so that any
    // previously queued (but not yet started) fetch is also invalidated.
    tokenRef.current += 1;
    const token = tokenRef.current;

    debounceRef.current = setTimeout(async () => {
      // Abort the previous request (if any) and start a new one
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const params = new URLSearchParams({ search: q, limit: "10" });
        const res = await fetch(`/api/articles?${params}`, {
          credentials: "include",
          signal: abortRef.current.signal,
        });

        // Discard if this search was superseded (query changed, user dismissed, etc.)
        if (token !== tokenRef.current) return;
        if (!res.ok) return;

        const data = await res.json() as { articles: WikilinkSuggestion[] };
        const results = (data.articles ?? []).slice(0, 10);
        setItems(results);
        setSelectedIndex(0);
        setIsOpen(results.length > 0);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // expected
        if (token !== tokenRef.current) return; // stale
        setIsOpen(false);
      }
    }, 200);
  }, []);

  const onInputChange = useCallback((value: string, cursor: number) => {
    const q = getWikilinkQueryAtCursor(value, cursor);
    if (q === null) {
      // No longer inside a [[ fragment — cancel immediately without waiting for debounce
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      tokenRef.current += 1; // invalidate any response still in flight
      setIsOpen(false);
      setItems([]);
      return;
    }
    runSearch(q);
  }, [runSearch]);

  const dismiss = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    tokenRef.current += 1; // invalidate any response still in flight
    setIsOpen(false);
    setItems([]);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>): boolean => {
    if (!isOpen || items.length === 0) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % items.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i + items.length - 1) % items.length);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
      return true;
    }
    return false;
  }, [isOpen, items.length, dismiss]);

  return { isOpen, items, selectedIndex, onInputChange, handleKeyDown, dismiss };
}
