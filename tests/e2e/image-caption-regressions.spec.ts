import { expect, test, type BrowserContext, type Page } from "playwright/test";

type User = {
  id: number;
  email: string;
  password: string;
};

type Article = {
  id: number;
  slug: string;
  title: string;
  content: string;
};

const prefix = `e2e-image-caption-${Date.now()}`;
const password = "e2e-image-caption-password";
const caption = `A & <caption> \"quoted\" ${prefix}`;
const imageSrc =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='120'%3E%3Crect width='280' height='120' fill='%23d9ead3'/%3E%3C/svg%3E";

async function requestJson<T>(
  context: BrowserContext,
  method: "get" | "post" | "patch" | "delete",
  url: string,
  data?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await context.request[method](url, {
    data,
    headers:
      data === undefined ? undefined : { "Content-Type": "application/json" },
  });
  const body = (await response.json().catch(() => undefined)) as T;
  return { status: response.status(), body };
}

async function login(
  context: BrowserContext,
  email: string,
  userPassword: string,
) {
  const response = await requestJson(context, "post", "/api/auth/login", {
    email,
    password: userPassword,
  });
  expect(response.status).toBe(200);
}

async function getArticleFromApi(context: BrowserContext, slug: string) {
  return requestJson<Article>(
    context,
    "get",
    `/api/articles/${encodeURIComponent(slug)}`,
  );
}

async function assertImagesFit(page: Page, expectedTop: number) {
  const content = page.getByTestId("article-content");
  const contentBox = await content.boundingBox();
  expect(contentBox).not.toBeNull();

  const images = content.locator("img");
  await expect(images).toHaveCount(2);
  const boxes = await images.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    }),
  );

  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(contentBox!.left - 1);
    expect(box.right).toBeLessThanOrEqual(contentBox!.right + 1);
  }
  expect(boxes[0].top).toBeGreaterThanOrEqual(expectedTop - 1);
  expect(boxes[1].top).toBeGreaterThanOrEqual(expectedTop - 1);
  return boxes;
}

test("captioned and captionless images survive save/reload and responsive layout", async ({
  browser,
}) => {
  const context = await browser.newContext();
  let article: Article | undefined;
  let adminUser: User | undefined;

  try {
    const setupStatus = await requestJson<{ needsSetup: boolean }>(
      context,
      "get",
      "/api/auth/setup-status",
    );
    expect(setupStatus.status).toBe(200);

    if (setupStatus.body.needsSetup) {
      const setup = await requestJson<User & { user?: User }>(
        context,
        "post",
        "/api/auth/setup",
        {
          name: `${prefix} administrator`,
          email: `${prefix}-admin@example.test`,
          password,
        },
      );
      expect(setup.status).toBe(201);
      adminUser = setup.body.user ?? setup.body;
    } else {
      test.skip(
        !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD,
        "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD when testing against an initialized database.",
      );
      await login(
        context,
        process.env.E2E_ADMIN_EMAIL!,
        process.env.E2E_ADMIN_PASSWORD!,
      );
    }

    const seededContent = `<p><img src="${imageSrc}" width="280" data-caption='${caption}'><img src="${imageSrc}" width="280"></p>`;
    const created = await requestJson<Article>(
      context,
      "post",
      "/api/articles",
      {
        title: `${prefix} article`,
        content: seededContent,
      },
    );
    expect(created.status).toBe(201);
    article = created.body;

    // The API preserves the caption attribute, escapes attribute metacharacters,
    // and never lets caption input become executable markup.
    expect(article.content).toContain("data-caption=");
    expect(article.content).toContain("&amp;");
    expect(article.content).toContain("&lt;caption&gt;");
    expect(article.content).toContain("&quot;quoted&quot;");
    expect(article.content).not.toContain("<caption>");

    const page = await context.newPage();
    await page.goto(`/knowledge/${article.slug}`);
    const readerContent = page.getByTestId("article-content");
    await expect(readerContent.locator(".image-caption")).toHaveText(caption);
    await expect(readerContent.locator(".article-image")).toHaveCount(1);
    await assertImagesFit(page, (await readerContent.boundingBox())!.top);

    // Re-save through the editor serializer, then make sure both nodes can be
    // parsed back into their original captioned/captionless editor states.
    await page.getByTestId("button-edit-article").click();
    await expect(page.getByTestId("button-save-article")).toBeVisible();
    const captionInputs = page.getByLabel("Image caption");
    await expect(captionInputs).toHaveCount(2);
    await expect(captionInputs.nth(0)).toHaveValue(caption);
    await expect(captionInputs.nth(1)).toHaveValue("");
    await page.getByTestId("button-save-article").click();
    await expect(page).toHaveURL(new RegExp(`/knowledge/${article.slug}$`));
    await expect(
      page.getByTestId("article-content").locator(".image-caption"),
    ).toHaveText(caption);

    const reloaded = await getArticleFromApi(context, article.slug);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.content).toContain("data-caption=");
    expect(reloaded.body.content).toContain("&lt;caption&gt;");
    expect(reloaded.body.content).not.toContain("<caption>");

    await page.reload();
    await expect(
      page.getByTestId("article-content").locator(".image-caption"),
    ).toHaveText(caption);

    await page.setViewportSize({ width: 1200, height: 900 });
    const wideBoxes = await assertImagesFit(
      page,
      (await page.getByTestId("article-content").boundingBox())!.top,
    );
    expect(wideBoxes[1].top).toBeLessThan(wideBoxes[0].bottom);

    await page.setViewportSize({ width: 390, height: 844 });
    const phoneBoxes = await assertImagesFit(
      page,
      (await page.getByTestId("article-content").boundingBox())!.top,
    );
    expect(phoneBoxes[1].top).toBeGreaterThanOrEqual(phoneBoxes[0].bottom - 1);
  } finally {
    if (article)
      await context.request
        .delete(`/api/articles/${article.slug}`)
        .catch(() => undefined);
    if (adminUser?.id)
      await context.request
        .delete(`/api/users/${adminUser.id}`)
        .catch(() => undefined);
    await context.close();
  }
});
