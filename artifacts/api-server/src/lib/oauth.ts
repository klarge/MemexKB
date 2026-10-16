import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, oauthTokensTable, oauthGrantsTable, usersTable } from "@workspace/db";
import type { Request } from "express";
import { frontendUrl } from "./frontend-url";

export const OAUTH_SCOPE = "mcp:read";
export const ACCESS_SECONDS = 900;
export const GRANT_SECONDS = 30 * 24 * 60 * 60;
export const hashOAuth = (value: string) => createHash("sha256").update(value).digest("hex");
export const newOAuthSecret = (prefix = "") => prefix + randomBytes(32).toString("base64url");
export const pkceChallenge = (value: string) => createHash("sha256").update(value).digest("base64url");
export function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function oauthUrls(req: Request) {
  const base = frontendUrl(req);
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("OAuth requires an HTTPS APP_BASE_URL (HTTP is permitted only on loopback)");
  }
  return { base, issuer: `${base}/api/oauth`, resource: `${base}/mcp` };
}

export function validRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)));
  } catch { return false; }
}

export function oauthAllowsRequest(method: string, path: string): boolean {
  if (method !== "GET") return false;
  return [
    /^\/auth\/me\/?$/, /^\/articles(?:\/[^/]+)?\/?$/, /^\/tags\/?$/,
    /^\/projects(?:\/[0-9]+(?:\/documents(?:\/[^/]+)?)?)?\/?$/,
    /^\/boards\/[0-9]+\/?$/, /^\/cards\/[0-9]+\/comments\/?$/,
    /^\/log\/?$/, /^\/logs\/[0-9]+\/[^/]+\/?$/, /^\/tasks\/lists\/?$/,
  ].some(pattern => pattern.test(path));
}

export async function resolveOAuthAccess(raw: string) {
  const [row] = await db.select({
    userId: usersTable.id, userRole: usersTable.role,
    userName: usersTable.name, userEmail: usersTable.email,
    resource: oauthGrantsTable.resource,
  }).from(oauthTokensTable)
    .innerJoin(oauthGrantsTable, eq(oauthTokensTable.grantId, oauthGrantsTable.id))
    .innerJoin(usersTable, eq(oauthGrantsTable.userId, usersTable.id))
    .where(and(
      eq(oauthTokensTable.hash, hashOAuth(raw)), eq(oauthTokensTable.kind, "access"),
      gt(oauthTokensTable.expiresAt, new Date()), isNull(oauthGrantsTable.revokedAt),
      gt(oauthGrantsTable.expiresAt, new Date()),
    )).limit(1);
  return row ?? null;
}

export interface OAuthPending {
  clientId: string; redirectUri: string; challenge: string; state?: string;
  resource: string; csrf: string; expiresAt: number; userId: number;
}
declare module "express-session" {
  interface SessionData {
    oauthPending?: OAuthPending;
    oauthConnectionsCsrf?: string;
  }
}
