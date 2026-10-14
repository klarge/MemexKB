import { parseDocument } from 'htmlparser2';
import serialize from 'dom-serializer';
import { Element, Text, type AnyNode } from 'domhandler';
import type { CachedArticle, ContentKind, ProcedureStep } from './types';

export function contentKind(article: { kind?: ContentKind }): ContentKind {
  return article.kind ?? 'knowledge';
}

export function contentKindLabel(article: { kind?: ContentKind }): string {
  return { knowledge: 'Knowledge', policy: 'Policy', procedure: 'Procedure' }[contentKind(article)];
}

/** Descriptions are stored HTML; escape step titles, never their trusted markup.
 * Rendering, image discovery and search all consume this same saved document. */
export function documentHtml(article: { content: string; kind?: ContentKind; procedureSteps?: ProcedureStep[] }): string {
  if (contentKind(article) !== 'procedure' || !article.procedureSteps?.length) return article.content;
  return `${article.content}<h2 id="procedure-steps">Procedure steps</h2>${article.procedureSteps.map((step, index) =>
    `<section id="procedure-step-${index + 1}"><h3>${index + 1}. ${escape(step.title)}</h3>${step.description}</section>`).join('')}`;
}

export function documentSearchText(article: Pick<CachedArticle, 'title' | 'content' | 'kind' | 'procedureSteps'>): string {
  return `${article.title} ${textFromHtml(documentHtml(article))}`.toLowerCase();
}

export function canonicalServer(value: string): string {
  const url = new URL(value.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter an HTTP or HTTPS server URL without credentials, a query, or a fragment.');
  }
  let path = url.pathname;
  while (path.endsWith('/')) path = path.slice(0, -1);
  return `${url.origin}${path}`;
}

export function scopeKey(scope: { server: string; userId: number }): string {
  return `@memex/offline/v2/${encodeURIComponent(canonicalServer(scope.server))}/${scope.userId}`;
}

/** Only server-owned image endpoints are eligible for authenticated downloading.
 * Never forward a cookie to arbitrary same-origin URLs or external origins. */
export function imagePath(source: string, server: string): string | null {
  try {
    const base = canonicalServer(server);
    const prefix = new URL(base).pathname.replace(/\/$/, '');
    const url = new URL(prefix && source.startsWith('/api/articles/images/') ? `${base}${source}` : source, `${base}/`);
    if (url.origin !== new URL(base).origin || url.username || url.password || url.search || url.hash) return null;
    const relative = url.pathname.slice(prefix.length);
    if (!url.pathname.startsWith(`${prefix}/`) || !/^\/api\/articles\/images\/[1-9][0-9]*$/.test(relative)) return null;
    return relative;
  } catch { return null; }
}

export function articleLink(href: string, server: string): { slug: string; fragment: string } | null {
  try {
    const base = canonicalServer(server);
    const prefix = new URL(base).pathname.replace(/\/$/, '');
    const url = new URL(prefix && /^\/(?:knowledge|wiki|policies|procedures)\//.test(href) ? `${base}${href}` : href, `${base}/`);
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith(`${prefix}/`)) return null;
    const match = /^\/(?:knowledge|wiki|policies|procedures)\/([^/]+)\/?$/.exec(url.pathname.slice(prefix.length));
    if (!match) return null;
    return { slug: decodeURIComponent(match[1]), fragment: url.hash.slice(1) };
  } catch { return null; }
}

function elements(nodes: AnyNode[], visit: (node: Element) => void) {
  for (const node of nodes) {
    if (node instanceof Element) { visit(node); elements(node.children, visit); }
  }
}

export function assetsIn(html: string, server: string): { paths: string[]; external: number } {
  const paths = new Set<string>();
  let external = 0;
  elements(parseDocument(html).children, node => {
    for (const src of [node.name === 'img' ? node.attribs.src : undefined, node.attribs['data-image']]) {
      if (!src) continue;
      const path = imagePath(src, server);
      if (path) paths.add(path); else external++;
    }
  });
  return { paths: [...paths], external };
}

export function textFromHtml(html: string): string {
  const doc = parseDocument(html);
  function text(nodes: AnyNode[]): string {
    return nodes.map(node => node instanceof Text ? node.data : node instanceof Element &&
      !['script', 'style'].includes(node.name) ? text(node.children) : '').join(' ');
  }
  return text(doc.children).replace(/\s+/g, ' ').trim();
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Reader-only normalization. It never changes the stored server document. */
export function readerHtml(article: { content: string; kind?: ContentKind; procedureSteps?: ProcedureStep[]; assetFiles?: Record<string, string> }, server: string): string {
  const doc = parseDocument(documentHtml(article));
  elements(doc.children, node => {
    // Resolve trusted document links before the renderer's URI normalizer,
    // which otherwise resolves relative links against the preview/app origin.
    const href = node.name === 'a' ? node.attribs.href : undefined;
    if (href && articleLink(href, server)) {
      const base = canonicalServer(server);
      const prefix = new URL(base).pathname;
      node.attribs.href = new URL(prefix && /^\/(?:knowledge|wiki|policies|procedures)\//.test(href)
        ? `${base}${href}` : href, `${base}/`).href;
    }
    if (node.attribs['data-type'] === 'infobox') {
      let rows: { label: string; value: string }[] = [];
      try {
        const value: unknown = JSON.parse(node.attribs['data-rows'] ?? '[]');
        if (Array.isArray(value)) rows = value.filter(row => row && typeof row.label === 'string' && typeof row.value === 'string');
      } catch { /* Invalid metadata has no trusted displayable rows. */ }
      const image = node.attribs['data-image'];
      const title = node.attribs['data-title'] ?? '';
      node.children = parseDocument(`<h3>${escape(title)}</h3>${image ? `<img src="${escape(image)}" alt="Infobox image">` : ''}<table>${rows.map(row =>
        `<tr><th>${escape(row.label)}</th><td>${escape(row.value).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`).children;
      node.children.forEach(child => { child.parent = node; });
    }
    if (node.name === 'img') {
      const path = imagePath(node.attribs.src ?? '', server);
      const local = path && article.assetFiles?.[path];
      if (local) {
        node.attribs.src = local;
        delete node.attribs.srcset;
        delete node.attribs.sizes;
      } else {
        node.name = 'p';
        node.attribs = {};
        node.children = [new Text(path ? '[Image not downloaded]' : '[External image unavailable offline]')];
      }
    }
    if (['iframe', 'video', 'audio', 'object', 'embed', 'script', 'style', 'input', 'button'].includes(node.name)) {
      node.name = 'p'; node.attribs = {};
      node.children = [new Text('[Interactive content is unavailable in this read-only reader]')];
    }
  });
  // Wikilinks exist as text in saved articles, not necessarily anchor markup.
  function wikilinks(nodes: AnyNode[], excluded = false) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node instanceof Element) {
        wikilinks(node.children, excluded || node.name === 'a' || ['citation', 'citation-sources'].includes(node.attribs['data-type']));
      } else if (node instanceof Text && !excluded) {
        const value = node.data;
        let cursor = 0, copied = 0;
        const replacement: AnyNode[] = [];
        while (cursor < value.length) {
          const start = value.indexOf('[[', cursor);
          if (start < 0) break;
          const close = value.indexOf(']', start + 2);
          if (close < 0) break;
          cursor = close + (value[close + 1] === ']' ? 2 : 1);
          if (close === start + 2 || value[close + 1] !== ']') continue;
          const body = value.slice(start + 2, close);
          const separator = body.indexOf('|');
          const target = (separator < 0 ? body : body.slice(0, separator)).trim();
          const label = (separator < 0 ? target : body.slice(separator + 1)).trim();
          const slug = target.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 100);
          replacement.push(new Text(value.slice(copied, start)), ...parseDocument(`<a href="${escape(`${canonicalServer(server)}/knowledge/${encodeURIComponent(slug)}`)}">${escape(label)}</a>`).children);
          copied = close + 2;
        }
        if (replacement.length) {
          replacement.push(new Text(value.slice(copied)));
          replacement.forEach(child => { child.parent = node.parent; });
          nodes.splice(i, 1, ...replacement);
          i += replacement.length - 1;
        }
      }
    }
  }
  wikilinks(doc.children);
  return serialize(doc);
}
