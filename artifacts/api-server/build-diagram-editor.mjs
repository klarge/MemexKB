import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Open } = require("unzipper");
const base = path.dirname(fileURLToPath(import.meta.url));
export const DRAWIO_VERSION = "32.4.1";
const digest = "b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820";

export async function buildDiagramEditor(dist) {
  const vendor = path.join(base, "vendor/drawio");
  const archive = await readFile(path.join(vendor, `drawio-${DRAWIO_VERSION}.war`));
  if (createHash("sha256").update(archive).digest("hex") !== digest) {
    throw new Error("Pinned draw.io archive checksum mismatch. Refusing to package it.");
  }
  const output = path.join(dist, "diagram-editor");
  // API dev rebuilds frequently: keep these immutable assets when their
  // checksum marker matches; API build clears only its JS bundle files.
  let extract = true;
  try {
    if ((await readFile(path.join(output, ".version"), "utf8")) === digest) extract = false;
  } catch { /* First build. */ }
  if (extract) {
    await rm(output, { recursive: true, force: true });
    const directory = await Open.buffer(archive);
    for (const entry of directory.files) {
    // Only the static editor is needed, not servlet code, cloud auth pages,
    // plugins, or service workers. No network download occurs during a build.
    if (entry.type !== "File" || entry.path.startsWith("WEB-INF/") ||
        entry.path.startsWith("META-INF/") || entry.path.startsWith("plugins/") ||
        entry.path.startsWith("connect/") || entry.path.includes("..") ||
        entry.path.startsWith("/") || entry.path.includes("\\") ||
        (!/^(js\/|styles\/|resources\/|stencils\/|shapes\/|images\/|img\/|mxgraph\/|math4\/)/.test(entry.path) &&
         !["index.html", "export-fonts.css", "favicon.ico"].includes(entry.path))) continue;
    const target = path.join(output, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await entry.buffer());
    }
  }
  // Modified upstream configuration file; all other editor assets stay intact.
  await writeFile(path.join(output, "js/PreConfig.js"), `/*
 * Copyright (c) 2006-2024, JGraph Holdings Ltd and draw.io AG.
 * Modified for Lexikon: self-hosted offline embedding, no remote services.
 */
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = null;
window.PROXY_URL = null;
window.DRAWIO_BASE_URL = window.location.href.split('?')[0].replace(/index\\.html$/, '');
window.DRAWIO_VIEWER_URL = null;
window.DRAWIO_LIGHTBOX_URL = null;
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = {
  enableCustomLibraries: false,
  defaultFonts: ['Arial', 'Helvetica', 'Times New Roman', 'Courier New'],
  fontCss: '',
  plugins: [],
  hideMenuItems: ['open', 'import', 'plugins', 'newLibrary', 'openLibrary', 'image', 'exportPdf']
};
urlParams['sync'] = 'manual';
urlParams['offline'] = '1';
urlParams['local'] = '1';
urlParams['lockdown'] = '1';
urlParams['plugins'] = '0';
urlParams['noTelemetry'] = '1';
`);
  for (const name of ["LICENSE", "UPSTREAM-README.md", "LIBAVOID-LICENSE", "README.md"]) {
    await writeFile(path.join(output, name), await readFile(path.join(vendor, name)));
  }
  await writeFile(path.join(output, ".version"), digest);
}
