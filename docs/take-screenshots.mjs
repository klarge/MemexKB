/**
 * Authenticated screenshot capture for README docs.
 * Usage: node docs/take-screenshots.mjs
 *
 * Requires: playwright (already in workspace dev-deps)
 * App must be running at BASE_URL.
 */

import { firefox } from "playwright";

const BASE = "http://127.0.0.1:80";
const EMAIL = "admin@example.com";
const PASS  = "admin123456";
const OUT   = "docs/screenshots";

async function api(fetch, method, path, body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json().catch(() => ({}));
}

async function shot(page, name, path, { wait = 800, width = 1280, height = 800 } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`  ✓ ${name}`);
}

(async () => {
  const FIREFOX = "/nix/store/0fp8wbmnv90dkhki96mb1gra81dsp78z-firefox-133.0.3/lib/firefox/firefox";
  const browser = await firefox.launch({ executablePath: FIREFOX });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ── 1. Login page ────────────────────────────────────────────────────────
  await shot(page, "login", "/login", { height: 700 });

  // ── 2. Authenticate ──────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`, { timeout: 8000 });
  console.log("  ✓ logged in");

  // ── 3. Seed demo data via authenticated API ──────────────────────────────
  const fetchFn = (url, opts) => page.evaluate(
    ([u, o]) => fetch(u, o).then(r => r.json().catch(() => ({}))),
    [url, opts]
  );

  // Enable log entries
  await fetchFn(`${BASE}/api/admin/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logEntriesEnabled: true }),
  });

  // Task list + tasks
  const list = await fetchFn(`${BASE}/api/tasks/lists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Q3 Launch" }),
  });
  if (list.id) {
    for (const title of ["Finalize API docs", "Write release notes", "Deploy to staging", "Notify beta users"]) {
      await fetchFn(`${BASE}/api/tasks/${list.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    }
    // Mark one complete
    const tasks = await fetchFn(`${BASE}/api/tasks/lists`);
    const first = tasks?.[0]?.tasks?.[0];
    if (first?.id) {
      await fetchFn(`${BASE}/api/tasks/${first.id}/toggle`, { method: "PATCH" });
    }

    // Second list
    const list2 = await fetchFn(`${BASE}/api/tasks/lists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Personal" }),
    });
    if (list2.id) {
      for (const t of ["Read SICP chapter 3", "Update dotfiles"]) {
        await fetchFn(`${BASE}/api/tasks/${list2.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: t }),
        });
      }
    }
  }

  // Project + board + columns + cards
  const proj = await fetchFn(`${BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Website Redesign", description: "Overhaul the marketing site for the v2 launch." }),
  });
  let boardId, colIds = [];
  if (proj.id) {
    const board = await fetchFn(`${BASE}/api/projects/${proj.id}/boards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sprint 1" }),
    });
    boardId = board.id;
    if (boardId) {
      for (const colName of ["Backlog", "In Progress", "Review", "Done"]) {
        const col = await fetchFn(`${BASE}/api/boards/${boardId}/columns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: colName }),
        });
        colIds.push(col.id);
      }
      const now = new Date();
      const cardData = [
        { col: 0, title: "Audit current site", due: null },
        { col: 0, title: "Define new information architecture", due: null },
        { col: 1, title: "Design hero section", due: new Date(now.getTime() + 3 * 864e5).toISOString() },
        { col: 1, title: "Build responsive nav", due: new Date(now.getTime() + 5 * 864e5).toISOString() },
        { col: 2, title: "Write homepage copy", due: new Date(now.getTime() - 864e5).toISOString() },
        { col: 3, title: "Set up CI pipeline", due: null },
        { col: 3, title: "Configure staging domain", due: null },
      ];
      for (const { col, title, due } of cardData) {
        const card = await fetchFn(`${BASE}/api/columns/${colIds[col]}/cards`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (card.id && due) {
          await fetchFn(`${BASE}/api/cards/${card.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dueDate: due }),
          });
        }
      }
    }
  }
  console.log("  ✓ demo data seeded");

  // ── 4. Screenshots ───────────────────────────────────────────────────────
  await shot(page, "dashboard",   "/",            { height: 820 });
  await shot(page, "knowledge",   "/knowledge",   { height: 820 });
  await shot(page, "log",         "/log",         { height: 720 });
  await shot(page, "tasks",       "/tasks",       { height: 820 });
  await shot(page, "projects",    "/projects",    { height: 720 });

  if (proj.id) {
    await shot(page, "project-detail", `/projects/${proj.id}`, { height: 800 });
    if (boardId) {
      await shot(page, "board", `/projects/${proj.id}/boards/${boardId}`, { height: 740, wait: 1200 });
    }
  }

  await shot(page, "admin-customization", "/admin/customization", { height: 900 });
  await shot(page, "admin-users",         "/admin/users",         { height: 720 });

  await browser.close();
  console.log("\nAll screenshots saved to docs/screenshots/");
})();
