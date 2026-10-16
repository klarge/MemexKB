import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import swaggerUi from "swagger-ui-express";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import YAML from "yamljs";
import router from "./routes";
import { logger } from "./lib/logger";
import { diagramAssetHeaders, diagramStaticAssets } from "./lib/diagram-assets";
import { enforceApiTokenAccess } from "./lib/auth";
import rateLimit from "express-rate-limit";
import { createApiRateLimiters, ingressRateLimitOptions } from "./lib/rate-limits";
import { csrfProtection } from "./lib/csrf";
import { pool } from "@workspace/db";
import type { Pool as PgPool } from "pg";
import oauthRouter, { oauthDiscovery, oauthProtectedResource } from "./routes/oauth";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PgSession = connectPgSimple(session);

const app: Express = express();

// Trust proxy configuration.
// Set TRUST_PROXY=1 (or any truthy number) when running behind a reverse proxy
// (nginx, Caddy, Traefik, AWS ALB, etc.) so that req.ip and req.secure reflect
// the real client rather than the proxy's address.
//
// Set TRUST_PROXY=0 or leave unset for direct Docker deployments where the
// container is exposed on the host without an intervening proxy.  Docker Desktop
// for Mac adds its own forwarding headers that can confuse express-session when
// trust proxy is enabled — if login redirects back to the login page immediately
// after a successful auth response, try TRUST_PROXY=0.
const rawTrustProxy = process.env.TRUST_PROXY;
const trustProxy =
  rawTrustProxy === undefined
    ? 1               // default: trust one hop (common reverse-proxy setups)
    : Number(rawTrustProxy);  // 0 = disabled, 1+ = number of hops to trust
if (trustProxy > 0) {
  app.set("trust proxy", trustProxy);
}

// Security headers — set before any route handlers.
// CSP is intentionally relaxed for the Swagger UI and the embedded editor;
// tighten per-env in a real deployment.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Sandboxed static editor assets are public and do not need API rate-limit
// quota or sessions. Install before generic CORS and application endpoints.
app.use("/api/diagram-editor", diagramAssetHeaders, diagramStaticAssets);

// Restrict cross-origin requests to explicitly configured origins.
// Defaults to same-origin only (no cross-origin) when CORS_ORIGIN is unset.
// Set CORS_ORIGIN to a comma-separated list of allowed origins (e.g. "https://app.example.com").
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : false;
app.use(cors({ origin: corsOrigins, credentials: true }));

// Explicit ingress middleware bounds work before body parsing and DB-backed auth.
app.use("/api", rateLimit(ingressRateLimitOptions));
app.use("/api", csrfProtection({
  baseUrl: process.env.APP_BASE_URL,
  allowedOrigins: corsOrigins || [],
}));

// Reduced body limits — 20 MB was unnecessarily large and enabled easy DoS.
// Images are stored via the dedicated /api/articles/images endpoint (base64, ~2 MB).
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET environment variable must be set in production");
}
if (!sessionSecret) {
  logger.warn("SESSION_SECRET is not set — using insecure default. Set SESSION_SECRET in production.");
}

const pgSessionStore = new PgSession({
  pool: pool as unknown as PgPool,
  tableName: "user_sessions",
  // Surface store errors in the server log so silent session failures are
  // visible (e.g. missing user_sessions table, pool exhaustion, etc.).
  errorLog: (...args: unknown[]) => logger.error({ err: args[0] }, "Session store error"),
});

app.use(
  session({
    store: pgSessionStore,
    secret: sessionSecret ?? "kb-dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: (() => {
      // COOKIE_SECURE=true should only be set when the app is served over HTTPS.
      // Leaving it false (the default) is correct for plain HTTP deployments.
      const secure = process.env.COOKIE_SECURE === "true";

      // COOKIE_SAMESITE controls the SameSite cookie attribute.
      // Valid values: "lax" (default), "strict", "none".
      // Note: browsers require Secure=true when SameSite=None; setting
      // COOKIE_SAMESITE=none automatically enables the Secure flag.
      const rawSameSite = (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase();
      let sameSite: "lax" | "strict" | "none";
      if (rawSameSite === "strict") {
        sameSite = "strict";
      } else if (rawSameSite === "none") {
        sameSite = "none";
      } else {
        sameSite = "lax";
      }
      const effectiveSecure = secure || sameSite === "none";

      return {
        secure: effectiveSecure,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite,
      };
    })(),
  }),
);

// Protocol endpoints authenticate their own clients and never use cookie identity
// to issue tokens. Mount before API bearer parsing (Basic auth is valid here).
app.use("/api/oauth", oauthRouter);
app.get("/.well-known/oauth-authorization-server/api/oauth", oauthDiscovery);
app.get("/.well-known/oauth-authorization-server", oauthDiscovery);
app.get("/.well-known/oauth-protected-resource/mcp", oauthProtectedResource);
app.get("/.well-known/oauth-protected-resource", oauthProtectedResource);

// Resolve bearer API keys before route-level auth and enforce read-only keys
// consistently across every mutating endpoint.
app.use("/api", enforceApiTokenAccess);

// Authenticated browsing, anonymous traffic and session controls have separate
// budgets; exhausting an article quota must not block login or session checks.
const { apiLimiter, authLimiter } = createApiRateLimiters();
app.use("/api", apiLimiter);

// Brute-force protection: 10 unsuccessful attempts per 15 minutes per IP.
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/setup", authLimiter);
app.use("/api/auth/mobile/start", authLimiter);
app.use("/api/auth/mobile/exchange", authLimiter);

// Swagger UI — restrict to non-production environments.
// In production, protect it behind the admin-only requireRole middleware or disable entirely.
if (process.env.NODE_ENV !== "production") {
  let swaggerDoc: object = {};
  try {
    const specPath = resolve(__dirname, "../../../lib/api-spec/openapi.yaml");
    swaggerDoc = YAML.load(specPath);
  } catch {
    try {
      const specPath = resolve(process.cwd(), "lib/api-spec/openapi.yaml");
      swaggerDoc = YAML.load(specPath);
    } catch {
      logger.warn("Could not load OpenAPI spec for Swagger UI");
    }
  }
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc, { customSiteTitle: "Knowledge Base API" }));
}

// Browsers and bookmark managers commonly request this conventional path
// instead of inspecting the icon link that React updates at runtime.
app.get("/favicon.ico", (_req, res) => {
  res.redirect(307, "/api/settings/favicon");
});

app.use("/api", router);

// Serve the pre-built frontend SPA when STATIC_DIR is set (Docker / production).
// All non-/api requests fall through to index.html so client-side routing works.
// /api/* paths are intentionally excluded so unmatched API routes keep returning
// proper JSON 404s rather than the HTML shell.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  app.use(express.static(staticDir));
  app.get(/^(?!\/api(?:\/|$)).*$/, (_req, res) => {
    res.sendFile(resolve(staticDir, "index.html"));
  });
}

export default app;
