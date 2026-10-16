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
| `list_projects` | List active or archived projects accessible to the caller |
| `get_project` | Read a project and its boards |
| `get_project_board` | Read columns, cards, due dates, and assignments on a board |
| `list_project_documents` | List documents in an accessible project |
| `get_project_document` | Read a document within an accessible project |
| `get_card_comments` | Read recent comments on an accessible card |
| `list_logs` | Browse the caller's own personal log entries |
| `get_log` | Read one of the caller's personal log entries |
| `list_tasks` | Browse the caller's own task lists and tasks |

All tools are read-only. Each request is checked using the API key supplied by the calling client. Articles and project content follow **the key owner's** access rights; tasks and logs are limited to that person's own data, even for admin keys. No user's key is stored in the server configuration or shared between requests. Feature settings follow the API's rules (admins can still read Projects and Tasks when those features are disabled); disabled Logs remain unavailable through MCP.

The underlying API caps a project list at 100 projects, a board at 300 cards, and task lists at 200 tasks total; the tools warn if the API has truncated a result. Project boards, documents, comments, and logs support paging through `boards_offset` or `offset`. `get_card_comments` returns up to 50 comments per page, newest first. Project member email addresses are not exposed by the MCP tools.

## Docker Compose

Both `docker-compose.yml` and `docker-compose.external-db.yml` start `mcp` alongside the app with `docker compose up -d`. The service calls the app internally at `http://app:3000` and publishes HTTP port **3001 on all Docker host interfaces**, like the app's port (change the host port with `MCP_PORT`). From the Docker host, `http://127.0.0.1:3001/mcp` works; an unauthenticated readiness check is available at `http://127.0.0.1:3001/healthz`.

**Restrict direct access to port 3001 with a firewall or equivalent network rules.** Compose now publishes it on every host interface, so without a firewall clients can bypass your HTTPS proxy and send bearer API keys over unencrypted HTTP. Permit access only from the reverse proxy (or its private network). For example, with Caddy running directly on the Docker host:

```caddyfile
wiki.example.com {
  @mcp path /mcp /mcp/*
  reverse_proxy @mcp 127.0.0.1:3001
  reverse_proxy 127.0.0.1:3000
}
```

Then point your Streamable HTTP MCP client to `https://wiki.example.com/mcp`. If the proxy runs in another container on the same Compose network, use `mcp:3001` and `app:3000` instead of host loopback. If it runs on another host, use the Docker host's **private** IP and allow only that proxy host to reach port 3001. Configure DNS, TLS, and firewall rules before opening the endpoint to remote clients. See the root README for the ECS/ALB equivalent.

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

Never put an API key in the URL, Docker Compose, or a shared `.env` file. OAuth-capable clients can instead use the per-user flow below. Clients that only support local stdio still need a compatible HTTP client/bridge; the former stdio launcher has been removed.

## Per-user OAuth

OAuth authorization-code flow with **S256 PKCE** is supported. Each employee
connects their own Memex account and explicitly approves read-only access.
Corporate SSO can be used for the sign-in step. A shared service-account
connection still has the service account's permissions; use **individual
connections**, not organization-wide shared credentials.

### Deployment

1. Set `APP_BASE_URL=https://wiki.example.com` to the installation's actual public
   HTTPS origin. Both Compose configurations pass this to the app and MCP
   containers; the AWS template supplies the configured domain automatically.
   Keep it identical in both services. Do not use an internal container hostname.
2. Serve `/mcp` **and `/mcp/*`** through the MCP reverse proxy as shown above.
   Serve `/api/*` and `/.well-known/*` through the web/API app. Keep HTTPS enabled
   and direct MCP HTTP access restricted. OAuth only permits plain HTTP on loopback.
3. Apply the normal database migration/startup process and rebuild/restart both
   services. New OAuth tables are included in the migration journal. Existing API
   keys continue to work.

### Connect the AI

Use `https://wiki.example.com/mcp` as the remote MCP URL and select OAuth or
per-user authentication in the AI client. Compatible clients discover these
endpoints automatically:

| Setting | URL / value |
|---|---|
| Issuer | `https://wiki.example.com/api/oauth` |
| Authorization | `https://wiki.example.com/api/oauth/authorize` |
| Token | `https://wiki.example.com/api/oauth/token` |
| Client registration | `https://wiki.example.com/api/oauth/register` |
| Revocation | `https://wiki.example.com/api/oauth/revoke` |
| Scope | `mcp:read` |
| Resource / audience | `https://wiki.example.com/mcp` |
| PKCE method | `S256` (required, including confidential clients) |

Metadata is available at
`/.well-known/oauth-authorization-server/api/oauth`,
`/.well-known/oauth-protected-resource/mcp`, and the MCP challenge's explicit
`/mcp/.well-known/oauth-protected-resource` URL.

The authorization and token requests must include the exact `resource` URL.
Only authorization-code and refresh-token grants are supported; client
credentials and application-wide impersonation are intentionally not supported.

If a client needs a preconfigured client ID, register it once (public registration
is rate limited to 10 requests per hour per IP):

```bash
curl --fail-with-body https://wiki.example.com/api/oauth/register \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"Corporate AI","redirect_uris":["https://ai.example.com/oauth/callback"],"token_endpoint_auth_method":"none"}'
```

Use the AI platform's **exact callback URL**, not the example. For clients that
require a secret, choose `client_secret_post` or `client_secret_basic` instead of
`none`; the secret is returned only once. Store it in the connector's secure
configuration, never in a prompt or tool arguments. Clients without dynamic
registration must accept the resulting client ID (and secret when applicable).
Registration is not administrator vetting: consent clearly labels client names
as developer-supplied. Only approve apps you trust.

### Access and lifecycle

- Every tool call resolves the employee's live identity, role and Memex content
  permissions. Group membership and role changes take effect on subsequent calls.
- Tokens are limited to MCP's read endpoints, not arbitrary API/admin endpoints.
  All existing article, project and personal-data authorization remains in force.
- Access tokens expire after **15 minutes**. Refresh tokens rotate on every use.
  Reusing a consumed refresh token revokes the whole connection; clients must
  serialize refresh operations rather than racing them.
- Connections expire after **30 days**, requiring the employee to reconnect.
- **Settings → Connected AI apps → Manage connected apps** lists each user's
  active grants. Disconnect immediately disables access and refresh tokens.
- Authorization codes expire after two minutes and can be exchanged only once.
  Codes, access/refresh tokens and confidential-client secrets are stored hashed.
- Deleting the Memex user removes their grants and tokens. OAuth credentials are
  not included in environment backups; restored users must reconnect.
- Keep the AI platform's conversation and retrieval caches isolated by employee:
  Memex cannot revoke content already copied into an external system.

Browser clients send an `Origin` header. By default the server rejects requests carrying an Origin; to allow one, set `MCP_ALLOWED_ORIGINS=https://your-client-origin.example` in the Compose `.env` file (comma-separated exact origins). Desktop clients usually do not send Origin. CORS preflight is supported for allowed origins.

## Local development

With the API server running locally, start the MCP service:

```bash
MEMEX_URL=http://localhost:3000 pnpm --filter @workspace/mcp-server run dev
```

It binds to `127.0.0.1:3001` by default outside Docker. In Compose, `MCP_HOST=0.0.0.0` and the host port is published on **all interfaces**; use your firewall to limit direct access to the reverse proxy.

To confirm it is listening, `curl -f http://127.0.0.1:3001/healthz` should return `{"status":"ok"}`. To verify authentication without revealing a token, an unauthenticated `POST /mcp` should return `401`; a valid bearer key is required for initialization and every tool request. Invalid/expired keys return `401`, a disconnected app returns `503`, and disallowed browser Origins return `403`.

The endpoint is stateless: there is no shared session ID, so it can be served by multiple replicas once the app's startup migration process is coordinated for scale-out.
Upstream API tool requests time out after 10 seconds by default; set `MCP_API_TIMEOUT_MS` (100–60000 milliseconds) to change this. If the app rate-limits token validation, MCP forwards HTTP 429 and `Retry-After`.