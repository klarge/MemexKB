import { existsSync, readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "playwright/test";

type FixtureUser = { id: number; email: string; password: string; role: "admin" | "editor" | "user" };
type PoliciesFixture = {
  prefix: string;
  users: FixtureUser[];
  subject: { id: number; name: string };
};

// The fixture is supplied by the test harness, not committed with credentials.
const fixturePath = process.env.POLICIES_PROCEDURES_FIXTURE ?? "/tmp/memex-policies-browser.json";
const fixtureAvailable = existsSync(fixturePath);
const fixture = fixtureAvailable
  ? JSON.parse(readFileSync(fixturePath, "utf8")) as PoliciesFixture
  : undefined;

async function signIn(page: Page, user: FixtureUser) {
  await page.goto("/login");
  await page.getByTestId("input-email").fill(user.email);
  await page.getByTestId("input-password").fill(user.password);
  await page.getByTestId("button-login").click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 }).catch(() => undefined);
  // The app can render a blank first frame immediately after login; reload after
  // the auth cookie has been set, matching the supported browser login flow.
  await page.reload();
}

async function dragCardToDone(page: Page, title: string) {
  const grip = page.getByText(title, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"group/card")][1]')
    .locator(".cursor-grab");
  const gripBox = await grip.boundingBox();
  const doneBox = await page.getByRole("button", { name: /^Done/ }).first().boundingBox();
  if (!gripBox || !doneBox) throw new Error(`Could not locate drag handle or Done column for ${title}`);
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("Policies/Procedures authoring creates an immutable project snapshot", async ({ browser }) => {
  test.skip(!fixture, "Set POLICIES_PROCEDURES_FIXTURE to a test fixture JSON path.");
  const users = Object.values(fixture!.users);
  const adminUser = users.find((user) => user.role === "admin")!;
  const editorUser = users.find((user) => user.role === "editor")!;
  const regularUser = users.find((user) => user.role === "user")!;
  const adminContext = await browser.newContext();
  const editorContext = await browser.newContext();
  const userContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const editorPage = await editorContext.newPage();
  const userPage = await userContext.newPage();
  let policySlug: string | undefined;
  let procedureSlug: string | undefined;
  let projectId: string | undefined;
  let nestedCategoryId: string | undefined;
  let originalPolicyEnabled = false;
  let originalProcedureEnabled = false;

  try {
    await signIn(adminPage, adminUser);
    await expect(adminPage.getByText("Admin", { exact: true })).toBeVisible();
    await adminPage.goto("/admin/customization");
    const policySwitch = adminPage.getByTestId("switch-policy-enabled");
    const procedureSwitch = adminPage.getByTestId("switch-procedure-enabled");
    originalPolicyEnabled = await policySwitch.isChecked();
    originalProcedureEnabled = await procedureSwitch.isChecked();
    if (!originalPolicyEnabled) await policySwitch.click();
    if (!originalProcedureEnabled) await procedureSwitch.click();
    await expect(adminPage.getByTestId("select-policy-template")).toHaveValue("1");
    await expect(adminPage.getByTestId("select-procedure-template")).toHaveValue("2");

    const nestedName = `${fixture!.prefix} Nested Category`;
    await adminPage.getByTestId("input-subject-name").fill(nestedName);
    await adminPage.getByTestId("select-subject-parent").selectOption({ label: fixture!.subject.name });
    await adminPage.getByRole("button", { name: "Add Category" }).click();
    await expect(adminPage.getByText(nestedName, { exact: true })).toBeVisible();

    await signIn(editorPage, editorUser);
    await expect(editorPage.getByText("Editor", { exact: true })).toBeVisible();
    await editorPage.goto("/policies/new");
    await editorPage.getByTestId("input-article-title").fill(`${fixture!.prefix} Policy`);
    const nestedOption = editorPage.getByTestId("select-policy-subject").locator("option").filter({ hasText: nestedName });
    nestedCategoryId = (await nestedOption.getAttribute("value")) ?? undefined;
    expect(nestedCategoryId).toBeTruthy();
    await editorPage.getByTestId("select-policy-subject").selectOption(nestedCategoryId!);
    await expect(editorPage.getByTestId("select-policy-subject")).toHaveValue(nestedCategoryId!);
    await editorPage.getByTestId("button-save-article").click();
    await expect(editorPage).toHaveURL(/\/policies\/[^/]+$/);
    policySlug = new URL(editorPage.url()).pathname.split("/").pop()!;
    await editorPage.goto(`/policies/${policySlug}`);
    await expect(editorPage.getByTestId("badge-kind")).toHaveText("Policy");
    await expect(editorPage.getByTestId("article-content")).toContainText("Purpose");
    await expect(editorPage.getByTestId("article-content")).toContainText("Scope");
    await expect(editorPage.getByTestId("button-run-procedure")).toHaveCount(0);

    await editorPage.goto("/procedures/new");
    await expect(editorPage.getByTestId("step-row-0")).toContainText("First step");
    await editorPage.getByTestId("input-article-title").fill(`${fixture!.prefix} Procedure`);
    await editorPage.getByTestId("input-step-title-0").fill("Review policy");
    await editorPage.getByTestId("input-step-description-0").fill(`Review the approved policy: [[${policySlug}|Policy]].`);
    await editorPage.getByTestId("button-add-step").click();
    await editorPage.getByTestId("input-step-title-1").fill("Independent follow-up");
    await editorPage.getByTestId("input-step-description-1").fill("Complete the independent follow-up action.");
    await editorPage.getByRole("button", { name: "Public" }).click();
    await editorPage.getByTestId("button-step-up-1").click();
    await editorPage.getByTestId("button-step-down-0").click();
    await expect(editorPage.getByTestId("step-row-0")).toContainText("Review policy");
    await expect(editorPage.getByTestId("step-row-1")).toContainText("Independent follow-up");
    await editorPage.getByTestId("button-save-article").click();
    await expect(editorPage).toHaveURL(/\/procedures\/[^/]+$/);
    procedureSlug = new URL(editorPage.url()).pathname.split("/").pop()!;
    await editorPage.goto(`/procedures/${procedureSlug}`);
    await expect(editorPage.getByTestId("badge-kind")).toHaveText("Procedure");
    await expect(editorPage.locator('[data-testid="step-0"] a')).toHaveAttribute("href", `/policies/${policySlug}`);

    await editorPage.getByTestId("button-run-procedure").click();
    await expect(editorPage.getByTestId("input-run-name")).toHaveValue(`${fixture!.prefix} Procedure`);
    await editorPage.getByTestId("input-run-name").fill(`${fixture!.prefix} Project`);
    await editorPage.getByTestId("button-confirm-run").click();
    await expect(editorPage).toHaveURL(/\/projects\/\d+\/boards\/\d+$/);
    const boardRoute = new URL(editorPage.url()).pathname;
    projectId = boardRoute.match(/\/projects\/(\d+)\//)?.[1];
    await expect(editorPage.getByText("To Do", { exact: true })).toBeVisible();
    await expect(editorPage.getByText("In Progress", { exact: true })).toBeVisible();
    await expect(editorPage.getByText("Done", { exact: true })).toBeVisible();
    await expect(editorPage.getByText("1. Review policy", { exact: true })).toBeVisible();
    await expect(editorPage.getByText("2. Independent follow-up", { exact: true })).toBeVisible();

    // Complete the second card first through its existing details UI.
    await editorPage.getByText("2. Independent follow-up", { exact: true }).click();
    await editorPage.getByTestId("checkbox-card-complete").click();
    await expect(editorPage.getByTestId("checkbox-card-complete")).toBeChecked();
    await editorPage.locator("div.fixed.inset-0 button").nth(1).click();
    await editorPage.getByText("1. Review policy", { exact: true }).click();
    await editorPage.getByTestId("checkbox-card-complete").click();
    await expect(editorPage.getByTestId("checkbox-card-complete")).toBeChecked();
    await editorPage.locator("div.fixed.inset-0 button").nth(1).click();

    await dragCardToDone(editorPage, "2. Independent follow-up");
    await expect(editorPage.getByRole("button", { name: /Done 1/ })).toBeVisible();
    await dragCardToDone(editorPage, "1. Review policy");
    await expect(editorPage.getByRole("button", { name: /Done 2/ })).toBeVisible();

    // Change the source after the run; the already-created project remains a snapshot.
    await editorPage.goto(`/procedures/${procedureSlug}`);
    await editorPage.getByTestId("button-edit-article").click();
    await editorPage.getByTestId("input-step-title-1").fill("Independent follow-up (source revised)");
    await editorPage.getByTestId("button-save-article").click();
    await expect(editorPage.getByText("Article updated")).toBeVisible();
    await editorPage.goto(boardRoute);
    await expect(editorPage.getByText("2. Independent follow-up", { exact: true })).toBeVisible();
    await expect(editorPage.getByText("Independent follow-up (source revised)", { exact: true })).toHaveCount(0);
    await editorPage.getByText("2. Independent follow-up", { exact: true }).click();
    await expect(editorPage.locator("div.fixed.inset-0 input").first()).toHaveValue("2. Independent follow-up");
    await expect(editorPage.locator("div.fixed.inset-0 textarea").first()).toHaveValue("Complete the independent follow-up action.");
    await editorPage.locator("div.fixed.inset-0 button").nth(1).click();

    await editorPage.goto(`/procedures/${procedureSlug}/history`);
    await expect(editorPage.getByText("2 saved versions", { exact: false })).toBeVisible();
    await editorPage.setViewportSize({ width: 402, height: 844 });
    await editorPage.goto(`/procedures/${procedureSlug}`);
    const widths = await editorPage.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(widths.document).toBe(widths.viewport);

    // A user login may be rate-limited by the shared test environment. If it
    // succeeds, assert the public article is readable without editor actions.
    await userPage.goto("/login");
    await userPage.getByTestId("input-email").fill(regularUser.email);
    await userPage.getByTestId("input-password").fill(regularUser.password);
    await userPage.getByTestId("button-login").click();
    const rateLimited = await userPage.getByText(/HTTP 429/).isVisible().catch(() => false);
    if (rateLimited) {
      test.info().annotations.push({ type: "verification-gap", description: "Regular-user login was rate-limited (HTTP 429)." });
    } else {
      await userPage.reload();
      await userPage.goto(`/procedures/${procedureSlug}`);
      await expect(userPage.getByTestId("section-procedure-steps")).toBeVisible();
      await expect(userPage.getByTestId("button-edit-article")).toHaveCount(0);
      await expect(userPage.getByTestId("button-run-procedure")).toHaveCount(0);
    }

    // Navigation is a setting, not an access-control boundary.
    await adminPage.goto("/admin/customization");
    if (await policySwitch.isChecked()) await policySwitch.click();
    if (await procedureSwitch.isChecked()) await procedureSwitch.click();
    await expect(adminPage.getByTestId("nav-policies")).toHaveCount(0);
    await expect(adminPage.getByTestId("nav-procedures")).toHaveCount(0);
    await editorPage.goto(`/procedures/${procedureSlug}`);
    await expect(editorPage.getByTestId("article-title")).toBeVisible();
  } finally {
    if (projectId) await adminContext.request.delete(`/api/projects/${projectId}`).catch(() => undefined);
    if (procedureSlug) await adminContext.request.delete(`/api/articles/${procedureSlug}`).catch(() => undefined);
    if (policySlug) await adminContext.request.delete(`/api/articles/${policySlug}`).catch(() => undefined);
    if (nestedCategoryId) {
      await adminPage.goto("/admin/customization").catch(() => undefined);
      adminPage.once("dialog", (dialog) => dialog.accept());
      await adminPage.getByTestId(`button-delete-subject-${nestedCategoryId}`).click().catch(() => undefined);
    }
    await adminPage.goto("/admin/customization").catch(() => undefined);
    const policySwitch = adminPage.getByTestId("switch-policy-enabled");
    const procedureSwitch = adminPage.getByTestId("switch-procedure-enabled");
    if (await policySwitch.count().catch(() => 0)) {
      if ((await policySwitch.isChecked()) !== originalPolicyEnabled) await policySwitch.click().catch(() => undefined);
      if ((await procedureSwitch.isChecked()) !== originalProcedureEnabled) await procedureSwitch.click().catch(() => undefined);
    }
    await Promise.all([adminContext.close(), editorContext.close(), userContext.close()]);
  }
});