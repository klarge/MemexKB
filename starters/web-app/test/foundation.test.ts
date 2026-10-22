import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { randomBytes, createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { withEphemeralIdp, samlResponse } from "./helpers/saml-fixtures";
import express from "express";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

test("Fresh installation, authorization, branding, recovery and real SSO protocols", { timeout:120_000 }, async t => {
  // Never borrow the donor DATABASE_URL. This suite can truncate ONLY a
  // deliberately named, dedicated verification database.
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, "Set TEST_DATABASE_URL to a fresh dedicated PostgreSQL database named starter_verify");
  assert.equal(new URL(url).pathname, "/starter_verify");
  process.env.DATABASE_URL = url;
  process.env.SESSION_SECRET = randomBytes(48).toString("hex");
  process.env.APP_BASE_URL = "http://starter.example.test";
  process.env.COOKIE_SECURE = "false";
  process.env.COOKIE_SAMESITE = "lax";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  const { migrate } = await import("../scripts/migrate");
  const { pool, db, usersTable, ssoConfigsTable, passwordResetTokensTable } = await import("../db");
  const { eq } = await import("drizzle-orm");
  const { createApp } = await import("../server/app");
  try {
    await migrate();
    await migrate(); // Re-running deployment migration is safe.
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "starter_verify");
    await pool.query("TRUNCATE users,groups,sso_configs,site_settings,user_sessions RESTART IDENTITY CASCADE");
    const app = createApp();
    const admin = request.agent(app), regular = request.agent(app), editor = request.agent(app);
    const origin = process.env.APP_BASE_URL;
    const password = randomBytes(20).toString("hex");
    let userId = 0, editorId = 0, groupId = 0;
    await t.test("first-run setup is serialized and logs in one administrator", async () => {
      assert.equal((await admin.get("/api/auth/setup-status")).body.needsSetup, true);
      const results = await Promise.all([
        admin.post("/api/auth/setup").set("Origin",origin).send({name:"Initial Admin",email:"admin@example.test",password}),
        request(app).post("/api/auth/setup").set("Origin",origin).send({name:"Racing Admin",email:"racer@example.test",password})
      ]);
      assert.deepEqual(results.map(r => r.status).sort(), [201,409]);
      const [account] = await db.select().from(usersTable);
      assert.ok(account);
      // Either request can win; authenticate the known winning identity.
      assert.equal((await admin.post("/api/auth/login").set("Origin",origin).send({email:account.email,password})).status,200);
      assert.equal((await admin.get("/api/auth/me")).body.role,"admin");
      assert.equal((await admin.get("/api/auth/setup-status")).body.needsSetup,false);
    });
    await t.test("create users and group, persist edits and membership", async () => {
      const user = await admin.post("/api/users").set("Origin",origin).send({name:"Regular User",email:"user@example.test",role:"user",password});
      assert.equal(user.status,201); userId=user.body.id;
      const ed = await admin.post("/api/users").set("Origin",origin).send({name:"Editor",email:"editor@example.test",role:"editor",password});
      assert.equal(ed.status,201); editorId=ed.body.id;
      assert.equal((await regular.post("/api/auth/login").set("Origin",origin).send({email:"user@example.test",password})).status,200);
      assert.equal((await editor.post("/api/auth/login").set("Origin",origin).send({email:"editor@example.test",password})).status,200);
      const group = await admin.post("/api/groups").set("Origin",origin).send({name:"Verification Team",description:"Private team"});
      assert.equal(group.status,201); groupId=group.body.id;
      assert.equal((await admin.patch(`/api/groups/${groupId}`).set("Origin",origin).send({name:"Renamed Team",description:"Updated"})).status,200);
      assert.equal((await admin.post(`/api/groups/${groupId}/members`).set("Origin",origin).send({userId})).status,200);
      assert.equal((await admin.get(`/api/groups/${groupId}`)).body.members[0].email,"user@example.test");
      assert.equal((await admin.get("/api/users")).body.find((u:{id:number})=>u.id===userId).groups[0].name,"Renamed Team");
      const detail = await regular.get(`/api/groups/${groupId}`);
      assert.equal(detail.status,200);
      assert.deepEqual(detail.body.members,[{id:userId,name:"Regular User"}]);
      assert.equal((await editor.get(`/api/groups/${groupId}`)).status,403);
      assert.deepEqual((await editor.get("/api/groups")).body,[]);
      assert.equal((await editor.get(`/api/users/${userId}/groups`)).status,403);
      assert.equal((await regular.get(`/api/users/${userId}/groups`)).status,200);
    });
    await t.test("every administration route rejects anonymous, user and editor access", async () => {
      const cases: Array<[string,string,object?]> = [
        ["get","/api/users"],["get",`/api/users/${userId}`],["post","/api/users",{name:"Intruder",email:"intruder@example.test",password,role:"admin"}],
        ["patch",`/api/users/${userId}`,{role:"admin"}],["delete",`/api/users/${userId}`],
        ["post","/api/groups",{name:"Intruder"}],["patch",`/api/groups/${groupId}`,{name:"Intruder"}],["delete",`/api/groups/${groupId}`],
        ["post",`/api/groups/${groupId}/members`,{userId:editorId}],["delete",`/api/groups/${groupId}/members/${userId}`],
        ["get","/api/admin/sso"],["post","/api/admin/sso",{}],["patch","/api/admin/sso/1",{}],["delete","/api/admin/sso/1"],
        ["get","/api/admin/settings"],["patch","/api/admin/settings",{siteName:"Intruder"}],
        ["post","/api/admin/settings/logo"],["delete","/api/admin/settings/logo"],
        ["post","/api/admin/settings/favicon"],["delete","/api/admin/settings/favicon"]
      ];
      for (const agent of [request.agent(app),regular,editor]) for (const [method,path,body] of cases) {
        const result = await (agent as any)[method](path).set("Origin",origin).send(body ?? {});
        assert.equal(result.status,agent === regular || agent === editor ? 403 : 401,`${method} ${path}`);
      }
      for (const path of ["/api/articles","/api/tasks","/api/projects","/api/oauth/token","/api/auth/mobile/start","/api/dev/screenshot-login"]) {
        assert.equal((await admin.get(path)).status,404,path);
      }
    });
    await t.test("CSRF rejects untrusted and missing origins; only exact SAML callback is exempt", async () => {
      assert.equal((await admin.patch("/api/admin/settings").set("Origin","https://evil.example").send({siteName:"No"})).status,403);
      assert.equal((await admin.patch("/api/admin/settings").set("X-Memex-Client","native").send({siteName:"No"})).status,403);
      assert.equal((await admin.post("/api/auth/saml/1/callback/extra").set("Origin","https://evil.example").send({})).status,403);
    });
    await t.test("branding updates, uploads and deletes persist without storing file bytes in SQL", async () => {
      assert.equal((await admin.patch("/api/admin/settings").set("Origin",origin).send({siteName:"Verification App",accentColor:"#123456"})).status,200);
      const settings = (await regular.get("/api/settings")).body;
      assert.equal(settings.siteName,"Verification App"); assert.equal(settings.accentColor,"#123456");
      assert.equal((await admin.patch("/api/admin/settings").set("Origin",origin).send({accentColor:"red"})).status,400);
      assert.equal((await admin.post("/api/admin/settings/logo").set("Origin",origin).attach("logo",Buffer.from("<svg/>"),{filename:"bad.svg",contentType:"image/svg+xml"})).status,400);
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xo6sAAAAASUVORK5CYII=","base64");
      for (const kind of ["logo","favicon"]) {
        assert.equal((await admin.post(`/api/admin/settings/${kind}`).set("Origin",origin).attach(kind,png,{filename:"test.png",contentType:"image/png"})).status,200);
        const response = await regular.get(`/api/settings/${kind}`);
        assert.equal(response.status,200); assert.equal(response.headers["content-type"],"image/png");
        assert.equal((await admin.delete(`/api/admin/settings/${kind}`).set("Origin",origin)).status,200);
      }
      const rows = (await pool.query("SELECT key FROM site_settings")).rows;
      assert.ok(!rows.some(r=>/_data$/.test(r.key)));
    });
    await t.test("password rotation, one-time recovery, SSO-only policy and last-admin protection", async () => {
      const next = randomBytes(20).toString("hex");
      assert.equal((await regular.post("/api/auth/change-password").set("Origin",origin).send({currentPassword:password,newPassword:next})).status,200);
      assert.equal((await request(app).post("/api/auth/login").set("Origin",origin).send({email:"user@example.test",password})).status,401);
      const token = randomBytes(32).toString("hex");
      await db.insert(passwordResetTokensTable).values({userId,tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+60_000)});
      assert.equal((await request(app).post("/api/auth/recovery/reset").set("Origin",origin).send({token,newPassword:password})).status,200);
      assert.equal((await regular.get("/api/auth/me")).status,401,"recovery revokes prior sessions");
      assert.equal((await request(app).post("/api/auth/recovery/reset").set("Origin",origin).send({token,newPassword:next})).status,400);
      await admin.patch(`/api/users/${userId}`).set("Origin",origin).send({ssoOnly:true});
      assert.equal((await request(app).post("/api/auth/login").set("Origin",origin).send({email:"user@example.test",password})).status,401);
      assert.equal((await admin.patch(`/api/users/${userId}`).set("Origin",origin).send({ssoOnly:false})).status,400);
      const me=(await admin.get("/api/auth/me")).body;
      assert.equal((await admin.delete(`/api/users/${me.id}`).set("Origin",origin)).status,400);
      assert.equal((await admin.patch(`/api/users/${me.id}`).set("Origin",origin).send({role:"user"})).status,400);
    });
    await t.test("signed SAML callbacks validate correlation, signatures, audience and replay", async () => {
      await withEphemeralIdp(async idp => {
        const row = await admin.post("/api/admin/sso").set("Origin",origin).send({
          provider:"saml",name:"Ephemeral SAML",enabled:true,
          config:{entryPoint:"https://idp.example.test/login",issuer:origin,idpCert:idp.certificate}
        });
        assert.equal(row.status,201); assert.notEqual(row.body.config.idpCert,idp.certificate);
        const id=row.body.id, callback=`/api/auth/saml/${id}/callback`;
        const metadata=await request(app).get(`/api/auth/saml/${id}/metadata`);
        assert.equal(metadata.status,200); assert.ok(metadata.text.includes(`${origin}${callback}`));
        const make = async (changes:Record<string,unknown>={}) => {
          const login=await request(app).get(`/api/auth/saml/${id}/login`);
          assert.equal(login.status,302);
          const xml=inflateRawSync(Buffer.from(new URL(login.headers.location).searchParams.get("SAMLRequest")!,"base64")).toString();
          const inResponseTo=/\bID="([^"]+)"/.exec(xml)![1];
          return samlResponse({audience:origin,callbackUrl:origin+callback,email:"saml@example.test",inResponseTo,assertionKey:idp.privateKey,responseKey:idp.privateKey,...changes});
        };
        const samlAgent=request.agent(app);
        const response=await make();
        assert.equal((await samlAgent.post(callback).set("Origin","https://idp.example.test").type("form").send({SAMLResponse:response})).headers.location,"/");
        assert.equal((await samlAgent.get("/api/auth/me")).body.ssoOnly,true);
        assert.equal((await request(app).post(callback).set("Origin","https://idp.example.test").type("form").send({SAMLResponse:response})).headers.location,"/login?error=saml_failed");
        for (const changes of [{audience:"https://wrong.example"},{tamperAssertion:true},{assertionKey:undefined},{responseKey:undefined},{inResponseTo:"_not_requested"}]) {
          const invalid=await make(changes);
          const result=await request(app).post(callback).set("Origin","https://idp.example.test").type("form").send({SAMLResponse:invalid});
          assert.equal(result.headers.location,"/login?error=saml_failed");
          assert.ok(!result.headers["set-cookie"]);
        }
        assert.equal((await samlAgent.post("/api/auth/change-password").set("Origin",origin).send({currentPassword:password,newPassword:password})).status,403);
        assert.equal((await admin.patch(`/api/admin/sso/${id}`).set("Origin",origin).send({name:"Renamed SAML",config:{idpCert:"••••••••"}})).status,200);
        assert.equal((await admin.get("/api/admin/sso")).body[0].name,"Renamed SAML");
        assert.equal((await admin.delete(`/api/admin/sso/${id}`).set("Origin",origin)).status,200);
      });
    });
    await t.test("OIDC fixture validates signed ID tokens, state, nonce, verified email and PKCE", async () => {
      const { privateKey,publicKey }=await generateKeyPair("RS256");
      const jwk={...await exportJWK(publicKey),kid:"test-key",alg:"RS256",use:"sig"};
      const idp=express(); idp.use(express.urlencoded({extended:false}));
      const server=idp.listen(0,"127.0.0.1");
      await new Promise<void>(resolve=>server.once("listening",resolve));
      const address=server.address(); assert.ok(address && typeof address!=="string");
      const issuer=`http://127.0.0.1:${address.port}`;
      let nonce="", challenge="", verified=true, wrongAudience=false;
      idp.get("/.well-known/openid-configuration",(_req,res)=>res.json({
        issuer,authorization_endpoint:issuer+"/authorize",token_endpoint:issuer+"/token",jwks_uri:issuer+"/jwks",
        response_types_supported:["code"],subject_types_supported:["public"],id_token_signing_alg_values_supported:["RS256"],
        token_endpoint_auth_methods_supported:["client_secret_basic"],code_challenge_methods_supported:["S256"]
      }));
      idp.get("/jwks",(_req,res)=>res.json({keys:[jwk]}));
      idp.post("/token",async(req,res)=>{
        assert.equal(createHash("sha256").update(req.body.code_verifier).digest("base64url"),challenge);
        const jwt=await new SignJWT({email:"oidc@example.test",email_verified:verified,name:"OIDC Fixture",nonce})
          .setProtectedHeader({alg:"RS256",kid:"test-key"}).setIssuer(issuer).setAudience(wrongAudience?"wrong-client":"fixture-client")
          .setSubject("fixture-sub").setIssuedAt().setExpirationTime("5m").sign(privateKey);
        res.json({access_token:"fixture-access",token_type:"Bearer",expires_in:300,id_token:jwt});
      });
      try {
        const row=await admin.post("/api/admin/sso").set("Origin",origin).send({
          provider:"oidc",name:"Ephemeral OIDC",enabled:true,
          config:{issuerUrl:issuer,clientId:"fixture-client",clientSecret:randomBytes(32).toString("hex")}
        });
        assert.equal(row.status,201); const id=row.body.id, agent=request.agent(app);
        const begin=async()=>{
          const result=await agent.get(`/api/auth/oidc/${id}/login`); assert.equal(result.status,302);
          const u=new URL(result.headers.location); nonce=u.searchParams.get("nonce")!;challenge=u.searchParams.get("code_challenge")!;
          assert.ok(challenge);assert.equal(u.searchParams.get("code_challenge_method"),"S256");
          return u.searchParams.get("state")!;
        };
        const state=await begin();
        assert.equal((await agent.get(`/api/auth/oidc/${id}/callback`).query({state,code:"fixture-code"})).headers.location,"/");
        assert.equal((await agent.get("/api/auth/me")).body.email,"oidc@example.test");
        assert.equal((await agent.get(`/api/auth/oidc/${id}/callback`).query({state,code:"fixture-code"})).headers.location,"/login?error=oidc_state");
        for (const failure of ["state","nonce","audience","email"]) {
          const s=await begin();
          if(failure==="nonce")nonce="incorrect";
          if(failure==="audience")wrongAudience=true;
          if(failure==="email")verified=false;
          const result=await agent.get(`/api/auth/oidc/${id}/callback`).query({state:failure==="state"?"wrong":s,code:"fixture-code"});
          assert.equal(result.headers.location,"/login?error=oidc_failed",failure);
          wrongAudience=false;verified=true;
        }
      } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
    });
    await t.test("role changes and deletion immediately revoke administrative access; remove membership and group", async () => {
      assert.equal((await admin.patch(`/api/users/${editorId}`).set("Origin",origin).send({role:"admin"})).status,200);
      assert.equal((await editor.get("/api/users")).status,200);
      assert.equal((await admin.patch(`/api/users/${editorId}`).set("Origin",origin).send({role:"user"})).status,200);
      assert.equal((await editor.get("/api/users")).status,403);
      assert.equal((await admin.delete(`/api/groups/${groupId}/members/${userId}`).set("Origin",origin)).status,200);
      assert.equal((await admin.get(`/api/groups/${groupId}`)).body.members.length,0);
      assert.equal((await admin.delete(`/api/groups/${groupId}`).set("Origin",origin)).status,200);
      assert.equal((await admin.delete(`/api/users/${editorId}`).set("Origin",origin)).status,200);
      assert.equal((await editor.get("/api/auth/me")).status,401);
      assert.equal((await admin.post("/api/auth/logout").set("Origin",origin)).status,200);
      assert.equal((await admin.get("/api/auth/me")).status,401);
    });
  } finally { await pool.end(); }
});
