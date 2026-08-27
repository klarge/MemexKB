import { expect, test, type BrowserContext } from "playwright/test";

type User = { id: number; email: string };
type Token = { id: number; token: string; accessMode: "full" | "read_only" };
type Project = { id: number };
type Document = { slug: string; content: string };
type Article = { slug: string; logSlug: string | null };

const prefix = `e2e-api-token-access-${Date.now()}`;
const password = "e2e-api-token-access-password";

async function requestJson<T>(
  context: BrowserContext,
  method: "get" | "post" | "patch" | "put" | "delete",
  url: string,
  data?: unknown,
  bearerToken?: string,
  authorizationScheme = "Bearer",
): Promise<{ status: number; body: T }> {
  const response = await context.request[method](url, {
    data,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(bearerToken ? { Authorization: `${authorizationScheme} ${bearerToken}` } : {}),
    },
  });
  const body = await response.json().catch(() => undefined) as T;
  return { status: response.status(), body };
}

async function login(context: BrowserContext, email: string) {
  const response = await requestJson(context, "post", "/api/auth/login", { email, password });
  expect(response.status).toBe(200);
}

test("read-only API keys inherit visibility but cannot modify data", async ({ browser }) => {
  const admin = await browser.newContext();
  const owner = await browser.newContext();
  const outsider = await browser.newContext();
  let ownerUser: User | undefined;
  let outsiderUser: User | undefined;
  let projectId: number | undefined;
  let logSlug: string | undefined;

  try {
    const autologin = await admin.request.get("/api/dev/autologin?redirect=/api/auth/me");
    expect(autologin.status()).toBe(200);

    const createUser = async (name: string): Promise<User> => {
      const email = `${prefix}-${name.toLowerCase()}@example.test`;
      const response = await requestJson<User>(admin, "post", "/api/users", {
        name,
        email,
        password,
        role: "editor",
      });
      expect(response.status).toBe(201);
      return { ...response.body, email };
    };

    ownerUser = await createUser("Owner");
    outsiderUser = await createUser("Outsider");
    await Promise.all([login(owner, ownerUser.email), login(outsider, outsiderUser.email)]);

    // Omitted accessMode remains compatible with existing full-access keys.
    const fullKey = await requestJson<Token>(owner, "post", "/api/auth/tokens", {
      name: `${prefix} full access`,
    });
    expect(fullKey.status).toBe(201);
    expect(fullKey.body.accessMode).toBe("full");

    const readOnlyKey = await requestJson<Token>(owner, "post", "/api/auth/tokens", {
      name: `${prefix} read only`,
      accessMode: "read_only",
    });
    expect(readOnlyKey.status).toBe(201);
    expect(readOnlyKey.body.accessMode).toBe("read_only");

    const outsiderReadOnlyKey = await requestJson<Token>(outsider, "post", "/api/auth/tokens", {
      name: `${prefix} outsider read only`,
      accessMode: "read_only",
    });
    expect(outsiderReadOnlyKey.status).toBe(201);

    // A full-access token can make normal changes and creates private content
    // that the owner's read-only key is allowed to read.
    const project = await requestJson<Project>(
      owner,
      "post",
      "/api/projects",
      { name: `${prefix} project`, description: "Token permission coverage" },
      fullKey.body.token,
    );
    expect(project.status).toBe(201);
    projectId = project.body.id;

    const document = await requestJson<Document>(
      owner,
      "post",
      `/api/projects/${projectId}/documents`,
      { title: `${prefix} document`, content: "<p>Owner-only project content.</p>" },
      fullKey.body.token,
    );
    expect(document.status).toBe(201);

    const log = await requestJson<Article>(
      owner,
      "post",
      "/api/articles",
      { title: `${prefix} private log`, content: "<p>Private owner content.</p>", isLogEntry: true },
      fullKey.body.token,
    );
    expect(log.status).toBe(201);
    expect(log.body.logSlug).toBeTruthy();
    logSlug = log.body.logSlug!;

    const readableProject = await requestJson<Project>(
      owner,
      "get",
      `/api/projects/${projectId}`,
      undefined,
      readOnlyKey.body.token,
    );
    expect(readableProject.status).toBe(200);
    const readableDocument = await requestJson<Document>(
      owner,
      "get",
      `/api/projects/${projectId}/documents/${document.body.slug}`,
      undefined,
      readOnlyKey.body.token,
    );
    expect(readableDocument.status).toBe(200);
    expect(readableDocument.body.content).toContain("Owner-only project content.");
    const readableLog = await requestJson<Article>(
      owner,
      "get",
      `/api/logs/${ownerUser.id}/${logSlug}`,
      undefined,
      readOnlyKey.body.token,
    );
    expect(readableLog.status).toBe(200);

    // The global guard rejects writes before individual route authorization.
    for (const [method, url, data] of [
      ["post", "/api/tasks/lists", { name: `${prefix} blocked list` }],
      ["post", "/api/articles", { title: `${prefix} blocked article`, content: "<p>Blocked</p>" }],
      ["patch", `/api/projects/${projectId}/documents/${document.body.slug}`, { content: "<p>Blocked</p>" }],
      ["delete", `/api/articles/${log.body.slug}`, undefined],
      ["delete", `/api/auth/tokens/${readOnlyKey.body.id}`, undefined],
    ] as const) {
      const blocked = await requestJson<{ error: string }>(owner, method, url, data, readOnlyKey.body.token);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe("Read-only API keys cannot modify data");
    }

    // HTTP authentication scheme names are case-insensitive. The owner has a
    // browser session here, so this also proves the bearer key still wins.
    const mixedCaseScheme = await requestJson<{ error: string }>(
      owner,
      "post",
      "/api/tasks/lists",
      { name: `${prefix} mixed-case scheme` },
      readOnlyKey.body.token,
      "bEaReR",
    );
    expect(mixedCaseScheme.status).toBe(403);
    expect(mixedCaseScheme.body.error).toBe("Read-only API keys cannot modify data");

    const fullWrite = await requestJson<{ id: number }>(
      owner,
      "post",
      "/api/tasks/lists",
      { name: `${prefix} permitted list` },
      fullKey.body.token,
    );
    expect(fullWrite.status).toBe(201);

    // A key from another user does not bypass the existing private-log check.
    const hiddenLog = await requestJson<{ error: string }>(
      outsider,
      "get",
      `/api/logs/${ownerUser.id}/${logSlug}`,
      undefined,
      outsiderReadOnlyKey.body.token,
    );
    expect(hiddenLog.status).toBe(404);
  } finally {
    if (projectId) await admin.request.delete(`/api/projects/${projectId}`).catch(() => undefined);
    if (logSlug) {
      const logs = await admin.request.get("/api/log").catch(() => undefined);
      if (logs?.ok()) {
        const entries = await logs.json() as Array<{ slug: string; logSlug: string | null }>;
        const entry = entries.find((item) => item.logSlug === logSlug);
        if (entry) await admin.request.delete(`/api/articles/${entry.slug}`).catch(() => undefined);
      }
    }
    if (ownerUser) await admin.request.delete(`/api/users/${ownerUser.id}`).catch(() => undefined);
    if (outsiderUser) await admin.request.delete(`/api/users/${outsiderUser.id}`).catch(() => undefined);
    await Promise.all([admin.close(), owner.close(), outsider.close()]);
  }
});