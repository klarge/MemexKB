import type { Response } from "express";
import { oauthUrls } from "./oauth";

export function escapeOAuth(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function oauthPage(res: Response, title: string, body: string, callbackOrigin?: string) {
  // Replit's preview can present the page with an opaque browser Origin.
  // CSP 'self' then fails even for an app-local form. Explicitly allow only
  // this installation's validated public origin, never an external client.
  const formOrigin = new URL(oauthUrls(res.req).base).origin;
  res.set({
    "Cache-Control": "no-store", Pragma: "no-cache", "Referrer-Policy": "no-referrer",
    // Browsers check form-action through redirects as well as the initial POST.
    // Only this app and the client's exact registered callback origin are allowed.
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${formOrigin}${callbackOrigin ? ` ${callbackOrigin}` : ""}; frame-ancestors 'none'; base-uri 'none'`,
    "X-Frame-Options": "DENY",
  });
  res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeOAuth(title)} · Memex</title>
    <style>body{margin:0;background:#f9f9f6;color:#24352f;font:16px/1.6 system-ui,sans-serif}
    main{max-width:560px;margin:8vh auto;padding:32px;background:white;border:1px solid #dce2db;border-radius:12px}
    h1{font-size:26px;line-height:1.25}a{color:#2d5349}button{font:inherit;cursor:pointer;border:1px solid #2d5349;padding:10px 20px;border-radius:6px;background:#2d5349;color:white}
    button.secondary{background:white;color:#2d5349}form{margin:20px 0}small{color:#56665e;overflow-wrap:anywhere}.actions{display:flex;gap:12px}
    article{border-top:1px solid #dce2db;padding:16px 0}@media(max-width:620px){main{margin:20px 12px;padding:24px}}</style></head>
    <body><main><small>MEMEX · CONNECTED APPS</small><h1>${escapeOAuth(title)}</h1>${body}</main></body></html>`);
}
