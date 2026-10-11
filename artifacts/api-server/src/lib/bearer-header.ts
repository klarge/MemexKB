/** Parse the scheme separator once; a whitespace-only header must not backtrack. */
export function bearerToken(header: string | undefined): string | null {
  if (!header || header.slice(0, 6).toLowerCase() !== "bearer") return null;
  const remainder = header.slice(6);
  if (!remainder || remainder[0].trim() !== "") return null;
  const token = remainder.trim();
  if (!token || ["\r", "\n", "\u2028", "\u2029"].some(character => token.includes(character))) return null;
  return token;
}
