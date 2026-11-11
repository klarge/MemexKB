const STORAGE_KEY = "memex.oauth.return";

function validReturn(value: string | null): value is string {
  if (!value?.startsWith("/api/oauth/authorize?") || value.length > 8192) return false;
  const url = new URL(value, window.location.origin);
  return url.origin === window.location.origin && url.pathname === "/api/oauth/authorize";
}

export function rememberOAuthReturn() {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  if (validReturn(value)) sessionStorage.setItem(STORAGE_KEY, value);
}

export function takeOAuthReturn(): URLSearchParams | null {
  const value = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  // Return only parsed query parameters, never a stored navigation target.
  return validReturn(value) ? new URL(value, window.location.origin).searchParams : null;
}
