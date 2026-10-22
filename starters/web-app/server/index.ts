import { createApp } from "./app";
import express from "express";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
const app = createApp();
// Fail explicitly if deployment migrations were forgotten.
await pool.query("SELECT id FROM users LIMIT 0");
if (process.env.NODE_ENV === "production") {
  const dir = resolve("dist/public");
  app.use(express.static(dir));
  app.get(/^(?!\/api(?:\/|$)).*$/, (_req,res) => res.sendFile(resolve(dir,"index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true, allowedHosts: true }, appType: "spa" });
  app.use(vite.middlewares);
}
const server = app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
const stop = () => server.close(() => { void pool.end().finally(() => process.exit(0)); });
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
