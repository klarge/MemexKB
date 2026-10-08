import { compile } from "@tailwindcss/node";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const artifactDir = path.dirname(fileURLToPath(import.meta.url));

// Compile the actual reader stylesheet, not a separate approximation of it.
// The generated CSS travels with the API bundle in both Replit and Docker.
export async function buildPdfStyles(distDir) {
  const source = path.resolve(artifactDir, "../knowledge-base/src/index.css");
  const css = (await readFile(source, "utf8")).replace(/@import url\([^;]+\);/g, "");
  const compiled = await compile(css, { base: path.dirname(source), onDependency() {} });
  let output = compiled.build([
    "prose", "prose-stone", "prose-sm", "max-w-none", "font-sans",
    "font-semibold", "text-3xl", "font-bold", "tracking-tight",
    "text-primary", "font-medium", "no-underline", "whitespace-pre-wrap",
    "prose-headings:font-semibold", "prose-a:text-primary", "prose-img:rounded-lg",
    "prose-table:border-collapse", "prose-td:border", "prose-td:border-border",
    "prose-td:px-3", "prose-td:py-2", "prose-th:border",
    "prose-th:border-border", "prose-th:bg-muted",
  ]);
  // Embed the reader's fonts; PDF generation never needs Google Fonts or
  // another network request, and Unicode/bold/italic text stays searchable.
  for (const name of ["plus-jakarta-sans", "jetbrains-mono"]) {
    for (const face of ["index.css", "wght-italic.css"]) {
      const fontCssPath = require.resolve(`@fontsource-variable/${name}/${face}`);
      let fontCss = await readFile(fontCssPath, "utf8");
      for (const match of [...fontCss.matchAll(/url\((['"]?)(\.\/files\/[^)'"]+)\1\)/g)]) {
        const font = await readFile(path.resolve(path.dirname(fontCssPath), match[2]));
        fontCss = fontCss.replace(match[0], `url(data:font/woff2;base64,${font.toString("base64")})`);
      }
      output += `\n${fontCss}`;
    }
  }
  output += `
  :root { --app-font-sans: 'Plus Jakarta Sans Variable', sans-serif;
    --app-font-mono: 'JetBrains Mono Variable', monospace; }
  html { background: white; }
  body { margin: 0; background: white; color: hsl(var(--foreground)); }
  main { width: 100%; }
  .pdf-title { font-size: 30px; font-weight: 700; line-height: 1.25;
    letter-spacing: -0.025em; margin: 0 0 24px; overflow-wrap: anywhere; }
  /* Chromium evaluates width queries against the printable page width, even
     with screen media. Do not activate the reader's mobile flex/stack layout. */
  [data-testid="article-content"] { display: block; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  h1, h2, h3, h4, h5, h6, caption { break-after: avoid; }
  tr, img, figure, blockquote { break-inside: avoid; }
  p, li { orphans: 3; widows: 3; }
  [data-testid="article-content"] > [data-type="infobox"],
  [data-testid="article-content"] > table.infobox {
    float: right; clear: right; width: 260px; max-width: 46%;
    margin: 0 0 1.25rem 1.5rem;
  }
  [data-testid="article-content"] > [data-type="infobox"] table.infobox {
    float: none; width: 260px; margin: 0; max-width: 100%;
  }
  .pdf-step { padding: 16px; margin: 16px 0; border: 1px solid hsl(var(--border));
    background: hsl(var(--card)); break-inside: avoid; }
  .pdf-step::after { content: ''; display: table; clear: both; }
  .pdf-step-number { float: left; width: 32px; height: 32px; line-height: 32px;
    text-align: center; background: hsl(var(--primary));
    color: hsl(var(--primary-foreground)); font-weight: 600; font-size: 14px; }
  .pdf-step-body { margin-left: 48px; }
  .pdf-step-body .prose { margin-top: 4px; }
  @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `;
  await writeFile(path.join(distDir, "article-pdf.css"), output);
}
