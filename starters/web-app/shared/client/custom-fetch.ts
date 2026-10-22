export type ErrorType<T = unknown> = ApiError<T>;
export type BodyType<T> = T;
export class ApiError<T = unknown> extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly data: T;
  constructor(response: Response, data: T) {
    super(typeof data === "object" && data && "error" in data ? String(data.error) : response.statusText);
    this.name = "ApiError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.data = data;
  }
}
// This export is web-only: all API requests use same-origin session cookies.
// There is no bearer-key integration or shared cross-project identity.
export async function customFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof options.body === "string" && !headers.has("content-type")) headers.set("content-type","application/json");
  const response = await fetch(url, { credentials:"include", ...options, headers });
  const type = response.headers.get("content-type") ?? "";
  const data = response.status === 204 ? null : type.includes("json") ? await response.json() : await response.text();
  if (!response.ok) throw new ApiError(response,data);
  return data as T;
}
