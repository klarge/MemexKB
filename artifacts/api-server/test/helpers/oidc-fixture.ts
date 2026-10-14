import express from "express";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

/** Local signed OIDC provider: no external accounts, secrets or network calls. */
export async function withOidcFixture(run: (issuer: string, setEmail: (email: string) => void) => Promise<void>) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "fixture", alg: "RS256", use: "sig" };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  let issuer = "";
  let email = "oidc-first@example.test";
  const codes = new Map<string, { nonce: string; email: string }>();
  app.get("/.well-known/openid-configuration", (_req, res) => res.json({
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"],
    subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
  }));
  app.get("/jwks", (_req, res) => res.json({ keys: [jwk] }));
  app.get("/authorize", (req, res) => {
    const code = randomBytes(32).toString("hex");
    codes.set(code, { nonce: String(req.query.nonce), email });
    const callback = new URL(String(req.query.redirect_uri));
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", String(req.query.state));
    res.redirect(callback.toString());
  });
  app.post("/token", (req, res) => {
    const entry = codes.get(req.body.code);
    codes.delete(req.body.code);
    if (!entry) { res.status(400).json({ error: "invalid_grant" }); return; }
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${enc({ alg: "RS256", kid: "fixture" })}.${enc({
      iss: issuer, aud: "fixture-client", sub: entry.email, email: entry.email,
      name: "Isolated OIDC user", nonce: entry.nonce, iat: now, exp: now + 300,
    })}`;
    res.json({
      id_token: `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`,
      access_token: "fixture-access", token_type: "Bearer", expires_in: 300,
    });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture failed to listen");
  issuer = `http://127.0.0.1:${address.port}`;
  try { await run(issuer, value => { email = value; }); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
