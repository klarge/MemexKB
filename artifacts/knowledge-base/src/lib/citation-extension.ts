import { Node as TiptapNode } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { Plugin, type EditorState } from "@tiptap/pm/state";

export type CitationSource = { description: string; url: string; number: number; refs: string[] };

export function validCitation(description: string, url: string): boolean {
  if (!description.trim() || description.length > 1000 || url.length > 2048 || /[\u0000-\u0020]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch { return false; }
}

export function sourceNodes(sources: CitationSource[]): DOMOutputSpec[] {
  return sources.map((source) => [
    "li", { id: `cite-source-${source.number}` },
    source.description, " — ",
    ["a", { href: source.url, target: "_blank", rel: "noopener noreferrer" }, source.url],
    " ",
    ...source.refs.map((id, index): DOMOutputSpec => [
      "a", { href: `#cite-ref-${id}`, "aria-label": `Back to reference ${source.number}.${index + 1}` },
      source.refs.length === 1 ? "↩" : `↩${index + 1}`,
    ]),
  ]);
}

// Numbers and the bibliography are derived from live inline references, not
// independently editable content. Appended transactions join the originating
// edit's history, so undo/redo restores both together.
export function normalizeCitations(state: EditorState) {
  const tr = state.tr;
  const sources: CitationSource[] = [];
  const keys = new Map<string, CitationSource>();
  const ids = new Set<string>();
  const lists: { pos: number; entries: CitationSource[]; size: number }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === "citationSources") {
      lists.push({ pos, entries: node.attrs.entries, size: node.nodeSize });
      return false;
    }
    if (node.type.name !== "citation") return true;
    const description = String(node.attrs.description ?? "").trim();
    const url = String(node.attrs.url ?? "").trim();
    if (!validCitation(description, url)) return false;
    let id = String(node.attrs.id ?? "");
    if (!/^c-[a-zA-Z0-9-]{1,64}$/.test(id) || ids.has(id)) id = `c-${crypto.randomUUID()}`;
    ids.add(id);
    const key = JSON.stringify([description, url]);
    let source = keys.get(key);
    if (!source) {
      source = { description, url, number: sources.length + 1, refs: [] };
      keys.set(key, source);
      sources.push(source);
    }
    source.refs.push(id);
    if (id !== node.attrs.id || source.number !== node.attrs.number ||
        description !== node.attrs.description || url !== node.attrs.url) {
      tr.setNodeMarkup(pos, undefined, { id, description, url, number: source.number });
    }
    return false;
  });
  const listIsCurrent = lists.length === 1 &&
    lists[0].pos + lists[0].size === state.doc.content.size &&
    JSON.stringify(lists[0].entries) === JSON.stringify(sources) && sources.length > 0;
  if (!listIsCurrent) {
    for (const list of lists.reverse()) tr.delete(list.pos, list.pos + list.size);
    if (sources.length) tr.insert(tr.doc.content.size, state.schema.nodes.citationSources.create({ entries: sources }));
  }
  return tr.docChanged ? tr : null;
}

export const Citation = TiptapNode.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  marks: "",
  addAttributes() {
    return {
      id: { default: "" }, description: { default: "" },
      url: { default: "" }, number: { default: 1 },
    };
  },
  parseHTML() {
    return [{
      tag: 'sup[data-type="citation"]',
      getAttrs: (element) => {
        const description = element.getAttribute("data-citation-description") ?? "";
        const url = element.getAttribute("data-citation-url") ?? "";
        if (!validCitation(description, url)) return false;
        return { id: element.getAttribute("data-citation-id") ?? "", description, url,
          number: Number(element.getAttribute("data-citation-number")) || 1 };
      },
    }];
  },
  renderHTML({ node }) {
    const { id, description, url, number } = node.attrs;
    return ["sup", {
      "data-type": "citation", "data-citation-id": id,
      "data-citation-description": description, "data-citation-url": url,
      "data-citation-number": number,
    }, ["a", { id: `cite-ref-${id}`, href: `#cite-source-${number}` }, `[${number}]`]];
  },
  addNodeView() {
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement("sup");
      dom.dataset.type = "citation";
      dom.contentEditable = "false";
      const button = document.createElement("button");
      button.type = "button";
      const render = () => {
        button.textContent = `[${current.attrs.number}]`;
        button.setAttribute("aria-label", `Edit citation ${current.attrs.number}`);
        button.title = `${current.attrs.description}\n${current.attrs.url}`;
      };
      button.addEventListener("click", () => editor.view.dom.dispatchEvent(
        new CustomEvent("citation-edit", { detail: current.attrs.id }),
      ));
      dom.append(button);
      render();
      return {
        dom,
        update: (next) => { if (next.type !== current.type) return false; current = next; render(); return true; },
        stopEvent: (event) => event.target instanceof globalThis.Node && dom.contains(event.target),
      };
    };
  },
});

export const CitationSources = TiptapNode.create({
  name: "citationSources",
  group: "block",
  atom: true,
  selectable: false,
  addAttributes() { return { entries: { default: [] } }; },
  parseHTML() { return [{ tag: 'div[data-type="citation-sources"]' }]; },
  renderHTML({ node }) {
    return ["div", { "data-type": "citation-sources" }, ["h2", {}, "Sources"],
      ["ol", {}, ...sourceNodes(node.attrs.entries)]];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.dataset.type = "citation-sources";
      dom.contentEditable = "false";
      const render = (entries: CitationSource[]) => {
        dom.replaceChildren();
        const heading = document.createElement("h2");
        heading.textContent = "Sources";
        const list = document.createElement("ol");
        for (const source of entries) {
          const item = document.createElement("li");
          item.append(document.createTextNode(`${source.description} — `));
          const link = document.createElement("a");
          link.textContent = source.url;
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          item.append(link);
          list.append(item);
        }
        dom.append(heading, list);
      };
      render(node.attrs.entries);
      return { dom, update: (next) => {
        if (next.type.name !== "citationSources") return false;
        render(next.attrs.entries); return true;
      }, stopEvent: () => true };
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (transactions, _old, state) =>
        transactions.some((tr) => tr.docChanged) ? normalizeCitations(state) : null,
    })];
  },
});