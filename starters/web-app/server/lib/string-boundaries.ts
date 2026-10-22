/** Remove a trailing run without an unanchored, backtracking expression. */
export function trimTrailingCharacter(value: string, character: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === character) end--;
  return value.slice(0, end);
}
