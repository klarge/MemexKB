import type { IncomingMessage, ServerResponse } from "node:http";

export function protectedResourceMetadata(req: IncomingMessage) {
  const base = (process.env.APP_BASE_URL?.trim() || `http://${req.headers.host}`).replace(/\/+$/, "");
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Configure an HTTPS APP_BASE_URL for MCP OAuth");
  }
  return {
    resource: `${base}/mcp`,
    authorization_servers: [`${base}/api/oauth`],
    scopes_supported: ["mcp:read"],
    bearer_methods_supported: ["header"],
    resource_name: "Memex MCP",
  };
}

export function oauthChallenge(req: IncomingMessage, res: ServerResponse) {
  try {
    const metadata = protectedResourceMetadata(req);
    res.setHeader("WWW-Authenticate", `Bearer realm="Memex MCP", resource_metadata="${metadata.resource}/.well-known/oauth-protected-resource", scope="mcp:read"`);
  } catch {
    // Legacy API keys continue to work even before OAuth's public URL is configured.
    res.setHeader("WWW-Authenticate", 'Bearer realm="Memex MCP"');
  }
}
