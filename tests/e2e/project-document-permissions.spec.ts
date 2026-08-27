import { expect, test, type BrowserContext } from "playwright/test";

type User = {
  id: number;
  email: string;
  password: string;
  name: string;
};

type Project = { id: number };
type Document = { id: number; slug: string; title: string; content: string };
type Version = { id: number; versionNumber: number };
type ArticleWithBacklinks = { backlinks: Array<{ slug: string }> };

const prefix = `e2e-project-document-${Date.now()}`;
const password = "e2e-project-document-password";

async function requestJson<T>(
  context: BrowserContext,
  method: "get" | "post" | "patch" | "put" | "delete",
  url: string,
  data?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await context.request[method](url, {
    data,
    headers: data === undefined ? undefined : { "Content-Type": "application/json" },
  });
  const body = await response.json().catch(() => undefined) as T;
  return { status: response.status(), body };
}

async function login(context: BrowserContext, email: string, userPassword: string) {
  const response = await requestJson(context, "post", "/api/auth/login", { email, password: userPassword });
  expect(response.status).toBe(200);
}

async function createUser(
  admin: BrowserContext,
  name: string,
  role: "user" | "editor",
): Promise<User> {
  const email = `${prefix}-${role}-${name.toLowerCase()}@example.test`;
  const response = await requestJson<User>(admin, "post", "/api/users", {
    name,
    email,
    password,
    role,
  });
  expect(response.status).toBe(201);
  return { ...response.body, password, email };
}

async function removeTestData(
  admin: BrowserContext | undefined,
  projectIds: number[],
  groupId: number | undefined,
  users: User[],
) {
  if (!admin) return;
  for (const projectId of projectIds) {
    await admin.request.delete(`/api/projects/${projectId}`).catch(() => undefined);
  }
  if (groupId) await admin.request.delete(`/api/groups/${groupId}`).catch(() => undefined);
  for (const user of users) {
    await admin.request.delete(`/api/users/${user.id}`).catch(() => undefined);
  }
}

test("project documents preserve project access across UI and global article routes", async ({ browser }) => {
  const admin = await browser.newContext();
  const owner = await browser.newContext();
  const member = await browser.newContext();
  const editor = await browser.newContext();
  const outsider = await browser.newContext();
  const users: User[] = [];
  const projectIds: number[] = [];
  let groupId: number | undefined;

  try {
    const setupStatus = await requestJson<{ needsSetup: boolean }>(admin, "get", "/api/auth/setup-status");
    expect(setupStatus.status).toBe(200);

    if (setupStatus.body.needsSetup) {
      const setup = await requestJson(admin, "post", "/api/auth/setup", {
        name: `${prefix} administrator`,
        email: `${prefix}-admin@example.test`,
        password,
      });
      expect(setup.status).toBe(201);
    } else {
      test.skip(
        !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD,
        "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD when testing against an initialized database.",
      );
      await login(admin, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    }

    const ownerUser = await createUser(admin, "Owner", "user");
    const memberUser = await createUser(admin, "Member", "user");
    const editorUser = await createUser(admin, "Editor", "editor");
    const outsiderUser = await createUser(admin, "Outsider", "user");
    users.push(ownerUser, memberUser, editorUser, outsiderUser);

    const group = await requestJson<{ id: number }>(admin, "post", "/api/groups", {
      name: `${prefix} collaborators`,
      description: "Project document permission regression coverage",
    });
    expect(group.status).toBe(201);
    groupId = group.body.id;
    for (const user of [memberUser, editorUser]) {
      const membership = await requestJson(admin, "post", `/api/groups/${groupId}/members`, { userId: user.id });
      expect(membership.status).toBe(200);
    }

    await Promise.all([
      login(owner, ownerUser.email, password),
      login(member, memberUser.email, password),
      login(editor, editorUser.email, password),
      login(outsider, outsiderUser.email, password),
    ]);

    const project = await requestJson<Project>(owner, "post", "/api/projects", {
      name: `${prefix} shared project`,
      description: "Shared only with the collaborators group",
    });
    expect(project.status).toBe(201);
    projectIds.push(project.body.id);

    const sharedTitle = `${prefix} shared document`;
    const shared = await requestJson<Document>(owner, "post", `/api/projects/${project.body.id}/documents`, {
      title: sharedTitle,
      content: "<p>Only project collaborators can read this document.</p>",
    });
    expect(shared.status).toBe(201);

    const share = await requestJson(owner, "post", `/api/projects/${project.body.id}/groups`, { groupId });
    expect(share.status).toBe(201);

    // A private project document that links to the shared document must not leak
    // through the shared document's global backlinks endpoint.
    const privateProject = await requestJson<Project>(owner, "post", "/api/projects", {
      name: `${prefix} private project`,
      description: "Not shared with the group",
    });
    expect(privateProject.status).toBe(201);
    projectIds.push(privateProject.body.id);
    const privateSource = await requestJson<Document>(
      owner,
      "post",
      `/api/projects/${privateProject.body.id}/documents`,
      { title: `${prefix} private backlink source`, content: `<p>[[${sharedTitle}]]</p>` },
    );
    expect(privateSource.status).toBe(201);

    // A regular group member can read the document but cannot change it.
    const memberList = await requestJson<{ documents: Document[] }>(
      member,
      "get",
      `/api/projects/${project.body.id}/documents`,
    );
    expect(memberList.status).toBe(200);
    expect(memberList.body.documents).toEqual(expect.arrayContaining([expect.objectContaining({ slug: shared.body.slug })]));

    const memberRead = await requestJson<Document>(
      member,
      "get",
      `/api/projects/${project.body.id}/documents/${shared.body.slug}`,
    );
    expect(memberRead.status).toBe(200);
    expect(memberRead.body.content).toContain("Only project collaborators");

    expect((await requestJson(member, "patch", `/api/projects/${project.body.id}/documents/${shared.body.slug}`, {
      content: "<p>Unauthorised change</p>",
    })).status).toBe(403);
    expect((await requestJson(member, "delete", `/api/projects/${project.body.id}/documents/${shared.body.slug}`)).status).toBe(403);
    expect((await requestJson(member, "patch", `/api/articles/${shared.body.slug}`, {
      content: "<p>Unauthorised global change</p>",
    })).status).toBe(403);
    expect((await requestJson(member, "delete", `/api/articles/${shared.body.slug}`)).status).toBe(403);
    expect((await requestJson(member, "put", `/api/articles/${shared.body.slug}/lock`)).status).toBe(403);

    const memberBacklinks = await requestJson<Array<{ slug: string }>>(member, "get", `/api/articles/${shared.body.slug}/backlinks`);
    expect(memberBacklinks.status).toBe(200);
    expect(memberBacklinks.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ slug: privateSource.body.slug })]));
    const memberArticle = await requestJson<ArticleWithBacklinks>(member, "get", `/api/articles/${shared.body.slug}`);
    expect(memberArticle.status).toBe(200);
    expect(memberArticle.body.backlinks).not.toEqual(expect.arrayContaining([expect.objectContaining({ slug: privateSource.body.slug })]));
    const ownerArticle = await requestJson<ArticleWithBacklinks>(owner, "get", `/api/articles/${shared.body.slug}`);
    expect(ownerArticle.status).toBe(200);
    expect(ownerArticle.body.backlinks).toEqual(expect.arrayContaining([expect.objectContaining({ slug: privateSource.body.slug })]));

    const memberPage = await member.newPage();
    await memberPage.goto(`/projects/${project.body.id}/documents/${shared.body.slug}`);
    await expect(memberPage.getByTestId("article-title")).toHaveText(shared.body.title);
    await expect(memberPage.getByTestId("article-content")).toContainText("Only project collaborators");
    await expect(memberPage.getByTestId("button-edit-article")).toHaveCount(0);
    await expect(memberPage.getByTestId("button-delete-article")).toHaveCount(0);

    // An editor who belongs to the shared group can create, edit, lock, and restore.
    const editorDocument = await requestJson<Document>(editor, "post", `/api/projects/${project.body.id}/documents`, {
      title: `${prefix} editor document`,
      content: "<p>Original editor document.</p>",
    });
    expect(editorDocument.status).toBe(201);

    const editorUpdate = await requestJson<Document>(
      editor,
      "patch",
      `/api/projects/${project.body.id}/documents/${editorDocument.body.slug}`,
      { content: "<p>Updated editor document.</p>" },
    );
    expect(editorUpdate.status).toBe(200);
    expect(editorUpdate.body.content).toContain("Updated editor document");

    const lock = await requestJson<{ lockedBy: { userId: number } }>(editor, "put", `/api/articles/${editorDocument.body.slug}/lock`);
    expect(lock.status).toBe(200);
    expect(lock.body.lockedBy.userId).toBe(editorUser.id);

    const versions = await requestJson<Version[]>(editor, "get", `/api/articles/${editorDocument.body.slug}/versions`);
    expect(versions.status).toBe(200);
    const original = versions.body.find((version) => version.versionNumber === 1);
    expect(original).toBeDefined();
    const restore = await requestJson(editor, "post", `/api/articles/${editorDocument.body.slug}/versions/${original!.id}/restore`);
    expect(restore.status).toBe(200);
    const restored = await requestJson<Document>(editor, "get", `/api/projects/${project.body.id}/documents/${editorDocument.body.slug}`);
    expect(restored.status).toBe(200);
    expect(restored.body.content).toContain("Original editor document");

    const editorPage = await editor.newPage();
    await editorPage.goto(`/projects/${project.body.id}/documents/${editorDocument.body.slug}`);
    await expect(editorPage.getByTestId("button-edit-article")).toBeVisible();

    // Unrelated users cannot discover the document through project or global routes.
    expect((await requestJson(outsider, "get", `/api/projects/${project.body.id}`)).status).toBe(403);
    expect((await requestJson(outsider, "get", `/api/projects/${project.body.id}/documents`)).status).toBe(403);
    expect((await requestJson(outsider, "get", `/api/projects/${project.body.id}/documents/${shared.body.slug}`)).status).toBe(403);
    expect((await requestJson(outsider, "get", `/api/articles/${shared.body.slug}`)).status).toBe(404);
    expect((await requestJson(outsider, "get", `/api/articles/${shared.body.slug}/export/md`)).status).toBe(404);
    expect((await requestJson(outsider, "get", `/api/articles/${shared.body.slug}/export/pdf`)).status).toBe(404);
    expect((await requestJson(outsider, "get", `/api/articles/${shared.body.slug}/backlinks`)).status).toBe(404);
    expect((await requestJson(outsider, "get", `/api/articles/${shared.body.slug}/versions`)).status).toBe(404);
    expect((await requestJson(outsider, "get", `/api/articles/${shared.body.slug}/versions/${original!.id}`)).status).toBe(404);
    expect((await requestJson(outsider, "post", `/api/articles/${shared.body.slug}/versions/${original!.id}/restore`)).status).toBe(404);
    expect((await requestJson(outsider, "patch", `/api/articles/${shared.body.slug}`, { content: "<p>Unauthorised outsider change</p>" })).status).toBe(403);
    expect((await requestJson(outsider, "delete", `/api/articles/${shared.body.slug}`)).status).toBe(403);
    expect((await requestJson(outsider, "get", `/api/articles/${shared.body.slug}/lock`)).status).toBe(404);
    expect((await requestJson(outsider, "put", `/api/articles/${shared.body.slug}/lock`)).status).toBe(404);
    expect((await requestJson(outsider, "delete", `/api/articles/${shared.body.slug}/lock`)).status).toBe(404);

    const outsiderPage = await outsider.newPage();
    await outsiderPage.goto(`/projects/${project.body.id}/documents/${shared.body.slug}`);
    await expect(outsiderPage.getByText(/could not load this article/i)).toBeVisible();
    await expect(outsiderPage.getByText("Only project collaborators can read this document.")).toHaveCount(0);

    // The project FK cascade must remove every project document and its history.
    const deleteProject = await requestJson(owner, "delete", `/api/projects/${project.body.id}`);
    expect(deleteProject.status).toBe(204);
    projectIds.splice(projectIds.indexOf(project.body.id), 1);
    expect((await requestJson(member, "get", `/api/articles/${shared.body.slug}`)).status).toBe(404);
    expect((await requestJson(editor, "get", `/api/articles/${editorDocument.body.slug}/versions`)).status).toBe(404);
  } finally {
    await removeTestData(admin, projectIds, groupId, users);
    await Promise.all([admin.close(), owner.close(), member.close(), editor.close(), outsider.close()]);
  }
});