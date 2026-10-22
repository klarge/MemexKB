import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pino from "pino";
import pinoHttp from "pino-http";
import { pool } from "@workspace/db";
import { csrfProtection } from "./lib/csrf";
import auth from "./routes/auth";
import users from "./routes/users";
import groups from "./routes/groups";
import ssoAdmin from "./routes/sso-admin";
import sso from "./routes/sso-auth";
import settings from "./routes/settings";

export function createApp() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw Error("A fresh SESSION_SECRET of at least 32 characters is required.");
  if (!process.env.APP_BASE_URL) throw Error("APP_BASE_URL is required.");
  const url = new URL(process.env.APP_BASE_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/") throw Error("APP_BASE_URL must be an origin, with no path.");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 0));
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-inline'"])],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    imgSrc: ["'self'", "data:", "blob:"], connectSrc: ["'self'", ...(process.env.NODE_ENV === "production" ? [] : ["ws:", "wss:"])],
    objectSrc: ["'none'"], upgradeInsecureRequests: url.protocol === "https:" ? [] : null
  } }, strictTransportSecurity: url.protocol === "https:" ? undefined : false }));
  app.use(pinoHttp({
    logger: pino({ level: process.env.LOG_LEVEL ?? "info" }),
    serializers: { req: req => ({ method: req.method, url: req.url?.split("?")[0] }), res: res => ({ statusCode: res.statusCode }) }
  }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use("/api", csrfProtection);
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ extended: false, limit: "2mb" }));
  const Store = connectPgSimple(session);
  app.use(session({
    store: new Store({ pool, tableName: "user_sessions", pruneSessionInterval: process.env.NODE_ENV === "test" ? false : 900 }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
    cookie: {
      httpOnly: true, secure: process.env.COOKIE_SECURE === "true" || process.env.COOKIE_SAMESITE === "none",
      sameSite: process.env.COOKIE_SAMESITE === "none" ? "none" : process.env.COOKIE_SAMESITE === "strict" ? "strict" : "lax",
      maxAge: 7 * 24 * 60 * 60_000
    }
  }));
  const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: process.env.NODE_ENV === "test" ? 100 : 10, skipSuccessfulRequests: true, standardHeaders: "draft-8", legacyHeaders: false });
  for (const route of ["login","setup","recovery/reset"]) app.use(`/api/auth/${route}`, loginLimit);
  app.get("/api/healthz", (_req,res) => res.json({ status: "ok" }));
  for (const router of [auth,users,groups,ssoAdmin,sso,settings]) app.use("/api", router);
  app.use("/api", (_req,res) => res.status(404).json({ error:"Not found" }));
  app.get("/favicon.ico", (_req,res) => res.redirect(307, "/api/settings/favicon"));
  const errors: ErrorRequestHandler = (error, req, res, _next) => {
    const code = error?.code;
    if (error?.name === "ZodError" || code === "23503" || error?.type === "entity.parse.failed") { res.status(400).json({ error:"Invalid request" }); return; }
    if (code === "23505") { res.status(409).json({ error:"That value is already in use" }); return; }
    if (error?.code === "LIMIT_FILE_SIZE") { res.status(413).json({ error:"File too large" }); return; }
    if (error?.status === 503) { res.status(503).json({ error:"Configure App Storage before uploading branding." }); return; }
    req.log.error({ type: error?.name, code }, "Request failed");
    res.status(500).json({ error: "Request failed" });
  };
  app.use(errors);
  return app;
}
