export const MEDIA_GRACE_DAYS = 7;
export const MEDIA_GRACE_MS = MEDIA_GRACE_DAYS * 24 * 60 * 60 * 1000;
export type MediaStatus = "current" | "history" | "recent" | "unused";

/** Conservatively retain URLs mentioned anywhere, not just img tags.
 * Normalize encoded URLs and HTML/JSON escapes before collecting numeric IDs.
 */
export function referencedImageIds(content: string): Set<number> {
  let text = content;
  for (let i = 0; i < 3; i++) {
    text = text.replace(/\\\//g, "/")
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (_, hex, decimal) => {
        const code = parseInt(hex ?? decimal, hex ? 16 : 10);
        return Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
      })
      .replace(/&(amp|sol|colon|percnt|num|plus);/gi, (_, name: string) =>
        ({ amp: "&", sol: "/", colon: ":", percnt: "%", num: "#", plus: "+" }[name.toLowerCase()] ?? ""))
      .replace(/(?:%[0-9a-f]{2})+/gi, encoded => {
        try { return decodeURIComponent(encoded); }
        catch { return encoded.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))); }
      });
  }
  const ids = new Set<number>();
  // Match the image endpoint's case-insensitive routing and parseInt semantics,
  // including legacy URLs with leading zeros, + signs, hex or trailing text.
  for (const match of text.matchAll(/\/api\/articles\/images\/\s*([^\s"'<>/\\]+)/gi)) {
    const id = Number.parseInt(match[1]);
    if (Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647) ids.add(id);
  }
  return ids;
}

export function mediaStatus(current: number, history: number, uploadedAt: Date, now: Date): MediaStatus {
  if (current > 0) return "current";
  if (history > 0) return "history";
  // Invalid/future dates fail closed: never eligible for deletion.
  if (!Number.isFinite(uploadedAt.getTime()) || now.getTime() - uploadedAt.getTime() < MEDIA_GRACE_MS) return "recent";
  return "unused";
}
