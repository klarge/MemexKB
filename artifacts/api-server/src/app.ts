import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import swaggerUi from "swagger-ui-express";
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
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET environment variable must be set in production");
}
if (!sessionSecret) {
  logger.warn("SESSION_SECRET is not set — using insecure default. Set SESSION_SECRET in production.");
}

app.use(
  session({
    store: new PgSession({ pool: pool as unknown as PgPool, tableName: "user_sessions", createTableIfMissing: true }),
    secret: sessionSecret ?? "kb-dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  }),
);

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

app.use("/api", router);

export default app;
