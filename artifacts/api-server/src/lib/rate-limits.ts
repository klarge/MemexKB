import type { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

interface RateLimitOptions {
  authenticatedLimit?: number;
  anonymousLimit?: number;
  sessionControlLimit?: number;
  authAttemptLimit?: number;
}

const credentialRoutes = new Set(["POST /auth/login", "POST /auth/setup"]);
const sessionRoutes = new Set(["GET /auth/me", "POST /auth/logout"]);

function routeKey(req: Request) {
  return `${req.method} ${req.path.toLowerCase().replace(/\/+$/, "")}`;
}

function callerKey(req: Request) {
  return req.session?.userId
    ? `user:${req.session.userId}`
    : `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
}

// Separate availability-critical session operations from ordinary API traffic.
// Normal browsing must not spend the quota needed to sign in or sign out.
export function createApiRateLimiters(options: RateLimitOptions = {}) {
  const common = {
    standardHeaders: "draft-7" as const,
    legacyHeaders: false,
  };
  const authenticated = rateLimit({
    ...common,
    windowMs: 60_000,
    limit: options.authenticatedLimit ?? 1_000,
    keyGenerator: callerKey,
    message: { error: "Too many requests. Please wait a minute and try again." },
  });
  const anonymous = rateLimit({
    ...common,
    windowMs: 15 * 60_000,
    limit: options.anonymousLimit ?? 1_000,
    keyGenerator: callerKey,
    message: { error: "Too many requests. Please wait up to 15 minutes and try again." },
  });
  const sessionControl = rateLimit({
    ...common,
    windowMs: 60_000,
    limit: options.sessionControlLimit ?? 300,
    keyGenerator: callerKey,
    message: { error: "Too many session requests. Please wait a minute and try again." },
  });
  const authLimiter = rateLimit({
    ...common,
    windowMs: 15 * 60_000,
    limit: options.authAttemptLimit ?? 10,
    // Successful sign-ins/setup must not count as failed password attempts.
    skipSuccessfulRequests: true,
    message: { error: "Too many unsuccessful sign-in attempts. Please wait up to 15 minutes and try again." },
  });
  const apiLimiter: RequestHandler = (req, res, next) => {
    const route = routeKey(req);
    if (credentialRoutes.has(route)) {
      next(); // Dedicated brute-force protection is installed for these routes.
    } else if (sessionRoutes.has(route)) {
      sessionControl(req, res, next);
    } else if (req.session?.userId) {
      authenticated(req, res, next);
    } else {
      anonymous(req, res, next);
    }
  };
  return { apiLimiter, authLimiter };
}
