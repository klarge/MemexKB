import express, { type RequestHandler } from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const assets = directory.endsWith("/dist") ? resolve(directory, "diagram-editor")
  : resolve(directory, "../../dist/diagram-editor");

/** Public, immutable vendor files only. No API data or session is exposed.
 * The frame has an opaque sandbox origin; CORS is granted ONLY to static
 * editor assets, never to application endpoints. */
export const diagramAssetHeaders: RequestHandler = (req, res, next) => {
  const origin = new URL(`${req.protocol}://${req.get("host")}`).origin;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  // CSP checks the whole ancestor chain. Replit's preview wraps the app in
  // another frame; SAMEORIGIN/self-only would reject the editor there even
  // though a direct browser test succeeds. This exception is static-only.
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${origin}/api/diagram-editor/`,
    "frame-src 'none'", "object-src 'none'", "base-uri 'self'",
    "form-action 'none'", "frame-ancestors 'self' https://replit.com https://*.replit.com",
    "sandbox allow-scripts allow-downloads",
  ].join("; "));
  next();
};
export const diagramStaticAssets = express.static(assets, { dotfiles: "deny", maxAge: 0, fallthrough: false });
