# Memex MCP Server

Memex exposes its knowledge base over the MCP **Streamable HTTP** transport. It runs as a long-lived service, not as a stdio subprocess on each user's computer.

## Tools

| Tool | Description |
|---|---|
| `search_articles` | Search titles and content |
| `get_article` | Read an article by slug |
| `list_articles` | Browse articles with filters and pagination |
| `list_tags` | List available tags |
| `get_backlinks` | Find articles linking to an article |

All tools are read-only. Each request is checked using the API key supplied by the calling client, and article/group permissions are those of **the key's owner**. No user's key is stored in the server configuration or shared between requests.

## Docker Compose

Both `docker-compose.yml` and `docker-compose.external-db.yml` start `mcp` alongside the app with `docker compose up -d`. The service calls the app internally at `http://app:3000` and listens at `http://127.0.0.1:3001/mcp` on the Docker host (change the host port with `MCP_PORT`). An unauthenticated readiness check is available at `http://127.0.0.1:3001/healthz`.

**Do not expose the HTTP port directly to the internet.** Run an HTTPS reverse proxy on the same Docker host, forwarding the `/mcp` path to `127.0.0.1:3001`. For example:

```caddyfile
wiki.example.com {
  reverse_proxy /mcp 127.0.0.1:3001
  reverse_proxy 127.0.0.1:3000
}
```

Then point your Streamable HTTP MCP client to `https://wiki.example.com/mcp`. If the proxy runs in another container on the same Compose network, use `mcp:3001` and `app:3000` instead of host loopback. Configure DNS and TLS before opening the endpoint to remote clients. See the root README for the ECS/ALB equivalent.

## Per-user authentication

1. Each user logs in to Memex and creates a **Read-only** key in **Settings → API Keys**. Save it securely; it is shown only once.
2. In an MCP client that supports Streamable HTTP and custom request headers, set the URL to `https://wiki.example.com/mcp` and the header `Authorization: Bearer <your own API key>`. The exact client settings vary; the following is a generic example, **not** universal configuration syntax:

   ```json
   {
     "url": "https://wiki.example.com/mcp",
     "headers": {
       "Authorization": "Bearer YOUR_OWN_READ_ONLY_API_KEY"
     }
   }
   ```

Never put an API key in the URL, Docker Compose, or a shared `.env` file. If your MCP client only supports OAuth (and cannot send a custom bearer header), it cannot authenticate with this API-key endpoint yet. Clients that only support local stdio also need a compatible HTTP client/bridge; the former stdio launcher has been removed.

Browser clients send an `Origin` header. By default the server rejects requests carrying an Origin; to allow one, set `MCP_ALLOWED_ORIGINS=https://your-client-origin.example` in the Compose `.env` file (comma-separated exact origins). Desktop clients usually do not send Origin. CORS preflight is supported for allowed origins.

## Local development

With the API server running locally, start the MCP service:

```bash
MEMEX_URL=http://localhost:3000 pnpm --filter @workspace/mcp-server run dev
```

It binds to `127.0.0.1:3001` by default. For containers, Compose sets `MCP_HOST=0.0.0.0` so the port is reachable from the host/proxy, while publishing it **only to host loopback**.

To confirm it is listening, `curl -f http://127.0.0.1:3001/healthz` should return `{"status":"ok"}`. To verify authentication without revealing a token, an unauthenticated `POST /mcp` should return `401`; a valid bearer key is required for initialization and every tool request. Invalid/expired keys return `401`, a disconnected app returns `503`, and disallowed browser Origins return `403`.

The endpoint is stateless: there is no shared session ID, so it can be served by multiple replicas once the app's startup migration process is coordinated for scale-out.
Upstream API tool requests time out after 10 seconds by default; set `MCP_API_TIMEOUT_MS` (100–60000 milliseconds) to change this. If the app rate-limits token validation, MCP forwards HTTP 429 and `Retry-After`.