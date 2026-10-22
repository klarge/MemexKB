import type { RequestHandler } from "express";
export const csrfProtection: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) ||
      (req.method === "POST" && /^\/auth\/saml\/\d+\/callback\/?$/.test(req.path))) {
    next(); return;
  }
  const source = req.get("origin") ?? req.get("referer");
  try {
    // A fixed public URL is required. Do not trust Host to authorize browser writes.
    if (source && new URL(source).origin === new URL(process.env.APP_BASE_URL!).origin) {
      next(); return;
    }
  } catch { /* Invalid or absent origins fail closed. */ }
  res.status(403).json({ error: "Cross-site request rejected." });
};
