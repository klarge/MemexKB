import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Trash2, Plus } from "lucide-react";

type InfoBoxRow = { label: string; value: string };

function safeParseRows(raw: unknown): InfoBoxRow[] {
  try {
    const parsed = JSON.parse(raw as string);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fallthrough */ }
  return [{ label: "", value: "" }];
}

function InfoBoxView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const title = (node.attrs.title as string) ?? "";
  const rows: InfoBoxRow[] = safeParseRows(node.attrs.rows);

  const setTitle = (v: string) => updateAttributes({ title: v });
  const setRows = (r: InfoBoxRow[]) => updateAttributes({ rows: JSON.stringify(r) });

  const addRow = () => setRows([...rows, { label: "", value: "" }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: "label" | "value", val: string) =>
    setRows(rows.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));

  return (
    <NodeViewWrapper
      as="div"
      className={`infobox-editor not-prose ${selected ? "ring-2 ring-primary rounded" : ""}`}
      style={{ float: "right", clear: "right", margin: "0 0 1rem 1.5rem", width: "260px" }}
    >
      <div className="border border-border rounded overflow-hidden text-sm bg-card shadow-sm select-none">
        <div className="bg-primary/10 border-b border-border px-2 py-2">
          <input
            className="w-full bg-transparent text-center font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none text-sm"
            placeholder="Infobox title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-b-0 group/row">
                <th
                  className="px-2 py-1.5 align-top bg-muted/40 text-left border-r border-border"
                  style={{ width: "42%" }}
                >
                  <input
                    className="w-full bg-transparent font-medium text-foreground placeholder:text-muted-foreground focus:outline-none text-xs"
                    placeholder="Label"
                    value={row.label}
                    onChange={(e) => updateRow(i, "label", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
                <td className="px-2 py-1.5 align-top">
                  <div className="flex items-start gap-1">
                    <input
                      className="min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none text-xs"
                      placeholder="Value"
                      value={row.value}
                      onChange={(e) => updateRow(i, "value", e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      onMouseDown={(e) => { e.preventDefault(); removeRow(i); }}
                      className="shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover/row:opacity-100 transition-opacity"
                      title="Remove row"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between px-2 py-1.5 bg-muted/20 border-t border-border">
          <button
            onMouseDown={(e) => { e.preventDefault(); addRow(); }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add row
          </button>
          <button
            onMouseDown={(e) => { e.preventDefault(); deleteNode(); }}
            className="text-xs text-destructive hover:text-destructive/70 flex items-center gap-1 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const InfoBoxExtension = Node.create({
  name: "infobox",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      title: { default: "" },
      rows: { default: JSON.stringify([{ label: "", value: "" }]) },
    };
  },

  parseHTML() {
    return [
      {
        tag: "table.infobox",
        getAttrs(el) {
          const node = el as HTMLElement;
          const caption = node.querySelector("caption");
          const title = caption?.textContent?.trim() ?? "";
          const rows: InfoBoxRow[] = Array.from(node.querySelectorAll("tr"))
            .map((tr) => ({
              label: (tr.querySelector("th")?.textContent ?? "").trim(),
              value: (tr.querySelector("td")?.textContent ?? "").trim(),
            }))
            .filter((r) => r.label || r.value);
          return { title, rows: JSON.stringify(rows.length ? rows : [{ label: "", value: "" }]) };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const title = (HTMLAttributes.title as string) ?? "";
    const rows: InfoBoxRow[] = safeParseRows(HTMLAttributes.rows);

    const trNodes = rows
      .filter((r) => r.label || r.value)
      .map((r): [string, object, ...unknown[]] => [
        "tr", {},
        ["th", {}, r.label],
        ["td", {}, r.value],
      ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return [
      "table",
      mergeAttributes({ class: "infobox" }),
      ...(title ? [["caption", {}, title]] : []),
      ["tbody", {}, ...trNodes],
    ] as any;
  },

  addNodeView() {
    return ReactNodeViewRenderer(InfoBoxView);
  },
});
