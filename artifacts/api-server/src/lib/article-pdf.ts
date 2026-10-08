/// <reference lib="dom" />
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { db, articleImagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sanitizeArticleHtml } from "./sanitize";
import type { ProcedureStep } from "@workspace/db";

export class PdfExportBusyError extends Error {}
let activeExports = 0;

async function chromiumPath() {
  for (const candidate of [
    process.env.CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/repl/tools/bin/chromium",
  ]) {
    if (!candidate) continue;
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try next supported installation. */ }
  }
  throw new Error("Chromium is required for PDF exports. Set CHROMIUM_EXECUTABLE_PATH.");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export async function renderArticlePdf(article: {
  id: number; title: string; content: string; procedureSteps?: ProcedureStep[];
}) {
  if (activeExports >= 2) throw new PdfExportBusyError("PDF exporter is busy. Please try again shortly.");
  activeExports++;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let deadline: NodeJS.Timeout | undefined;
  try {
    // Only images attached to the authorized article are embedded. Never
    // forward a session, fetch an arbitrary URL, or read a file from HTML.
    const images = await db.select().from(articleImagesTable).where(eq(articleImagesTable.articleId, article.id));
    const imageMap = Object.fromEntries(images.filter(image => /^image\/(png|jpeg|webp|gif|avif)$/.test(image.mimeType))
      .map(image => [image.id, `data:${image.mimeType};base64,${image.data}`]));
    // Bundled runtime lives in dist; direct tsx regression tests live in src/lib.
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const cssPath = path.basename(moduleDir) === "dist" ? path.join(moduleDir, "article-pdf.css")
      : path.resolve(moduleDir, "../../dist/article-pdf.css");
    const css = await readFile(cssPath, "utf8");
    const body = sanitizeArticleHtml(article.content);
    const steps = (article.procedureSteps ?? []).map((step, index) =>
      `<section class="pdf-step"><span class="pdf-step-number">${index + 1}</span><div class="pdf-step-body"><h3 class="font-semibold">${escapeHtml(step.title)}</h3><div class="prose prose-stone prose-sm max-w-none whitespace-pre-wrap" data-testid="article-content">${sanitizeArticleHtml(step.description)}</div></div></section>`,
    ).join("");
    browser = await chromium.launch({ executablePath: await chromiumPath(), headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"], timeout: 15000 });
    deadline = setTimeout(() => void browser?.close(), 45000);
    deadline.unref();
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    // Use the desktop reader styles, not the phone's infobox stacking rules.
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.emulateMedia({ media: "screen", colorScheme: "light" });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(article.title)}</title><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><main>
      <h1 class="pdf-title">${escapeHtml(article.title)}</h1>
      <div class="prose prose-stone max-w-none prose-headings:font-semibold prose-a:text-primary prose-img:rounded-lg prose-table:border-collapse prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-th:border prose-th:border-border prose-th:bg-muted" data-testid="article-content">${body}</div>
      ${steps ? `<h2 style="clear:both;margin-top:40px;margin-bottom:16px;font-size:20px;font-weight:600">Steps</h2>${steps}` : ""}
      </main></body></html>`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.evaluate((imageMap) => {
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="article-content"]')).forEach((region, index) => {
        const scope = index === 0 ? "body" : `step-${index}`;
        for (const element of Array.from(region.querySelectorAll<HTMLElement>('[id^="cite-ref-"], [id^="cite-source-"]'))) {
          element.id = `${scope}-${element.id}`;
        }
        for (const link of Array.from(region.querySelectorAll<HTMLAnchorElement>('a[href^="#cite-ref-"], a[href^="#cite-source-"]'))) {
          link.setAttribute("href", `#${scope}-${link.getAttribute("href")!.slice(1)}`);
        }
      });
      for (const image of Array.from(document.querySelectorAll<HTMLImageElement>("img"))) {
        const src = image.getAttribute("src") ?? "";
        const local = src.match(/(?:^|\/)api\/articles\/images\/(\d+)(?:[?#].*)?$/);
        if (local && imageMap[local[1]]) image.src = imageMap[local[1]];
        else if (!/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(src)) {
          // Match the old export's safe treatment of external images, but
          // make omissions explicit rather than leaving a broken image.
          const omitted = document.createElement("span");
          omitted.textContent = `[Image not embedded${image.alt ? `: ${image.alt}` : ""}]`;
          image.replaceWith(omitted);
          continue;
        }
        const caption = image.dataset.caption?.trim();
        if (caption) {
          const wrapper = document.createElement("span");
          wrapper.className = "article-image";
          const label = document.createElement("span");
          label.className = "image-caption";
          label.textContent = caption;
          image.before(wrapper);
          wrapper.append(image, label);
          image.removeAttribute("data-caption");
        }
      }
      // [[wikilinks]] are reader-visible text, including infobox values.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      for (const node of nodes) {
        if (node.parentElement?.closest('a,style,script,textarea,[data-type="citation"],[data-type="citation-sources"]')) continue;
        const text = node.textContent ?? "";
        const matches = Array.from(text.matchAll(/\[\[([^\]]+)\]\]/g));
        if (!matches.length) continue;
        const fragment = document.createDocumentFragment();
        let position = 0;
        for (const match of matches) {
          fragment.append(document.createTextNode(text.slice(position, match.index)));
          const divider = match[1].indexOf("|");
          const target = (divider < 0 ? match[1] : match[1].slice(0, divider)).trim();
          const label = (divider < 0 ? target : match[1].slice(divider + 1)).trim();
          const link = document.createElement("a");
          link.className = "text-primary font-medium no-underline";
          link.setAttribute("href", `/knowledge/${encodeURIComponent(target.toLowerCase().replace(/\s+/g, "-"))}`);
          link.textContent = label || target;
          fragment.append(link);
          position = match.index! + match[0].length;
        }
        fragment.append(document.createTextNode(text.slice(position)));
        node.replaceWith(fragment);
      }
    }, imageMap);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => undefined)));
    });
    return await page.pdf({ format: "A4", printBackground: true, tagged: true,
      margin: { top: "18mm", bottom: "18mm", left: "18mm", right: "18mm" } });
  } finally {
    clearTimeout(deadline);
    try { await browser?.close(); } finally { activeExports--; }
  }
}
