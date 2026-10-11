import type { RequestHandler } from "express";
import { bearerToken } from "./bearer-header";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

/** Browser writes require a trusted Origin/Referer; native clients use a non-simple header.
 * A cross-site form cannot set this header, and CORS must explicitly allow its origin.
 * SAML's exact assertion endpoint is cross-site by design and validates signed assertions.
 */
export function csrfProtection(config: { baseUrl?: string; allowedOrigins?: string[] } = {}): RequestHandler {
  const configuredOrigins = new Set([config.baseUrl, ...(config.allowedOrigins ?? [])].map(originOf).filter(Boolean));
  return (req, res, next) => {
    if (safeMethods.has(req.method) ||
        (req.method === "POST" && /^\/auth\/saml\/[0-9]+\/callback\/?$/i.test(req.path))) {
      next();
      return;
    }

    const originHeader = req.get("origin");
    const referer = req.get("referer");
    const sourceOrigin = originOf(originHeader ?? referer);
    let host = req.get("host");
    const trust = req.app.get("trust proxy fn") as ((address: string, hop: number) => boolean) | undefined;
    if (trust?.(req.socket.remoteAddress ?? "", 0)) {
      host = req.get("x-forwarded-host")?.split(",")[0].trim() ?? host;
    }
    const requestOrigin = originOf(`${req.protocol}://${host}`);
    if (sourceOrigin && (sourceOrigin === requestOrigin || configuredOrigins.has(sourceOrigin))) {
      next();
      return;
    }
    // Never let a header/token bypass a supplied untrusted or opaque Origin.
    if (!originHeader && !referer && req.get("sec-fetch-site") !== "cross-site" &&
        (req.get("x-memex-client") === "native" || bearerToken(req.get("authorization")))) {
      next();
      return;
    }
    res.status(403).json({ error: "Cross-site request rejected." });
  };
}
