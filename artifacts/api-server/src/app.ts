import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import swaggerUi from "swagger-ui-express";
import rateLimit from "express-rate-limit";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import YAML from "yamljs";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import type { Pool as PgPool } from "pg";

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
        frameSrc: ["'none'"],
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

// Restrict cross-origin requests to explicitly configured origins.
// Defaults to same-origin only (no cross-origin) when CORS_ORIGIN is unset.
// Set CORS_ORIGIN to a comma-separated list of allowed origins (e.g. "https://app.example.com").
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : false;
app.use(cors({ origin: corsOrigins, credentials: true }));

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
    cookie: {
      // COOKIE_SECURE=true should only be set when the app is served over HTTPS.
      // Leaving it false (the default) is correct for plain HTTP deployments.
      secure: process.env.COOKIE_SECURE === "true",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  }),
);

// Rate limiting on authentication endpoints to prevent brute-force attacks.
// 10 attempts per 15-minute window per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later." },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/setup", authLimiter);

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
