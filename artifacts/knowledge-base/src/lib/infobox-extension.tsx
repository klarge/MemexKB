import { useCallback, useEffect, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  useWikilinkAutocomplete,
  insertWikilink,
  getWikilinkQueryAtCursor,
  type WikilinkSuggestion,
} from "./use-wikilink-autocomplete";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Trash2, Plus, Loader2, X, Image as ImageIcon } from "lucide-react";

type InfoBoxRow = { label: string; value: string };

function safeParseRows(raw: unknown): InfoBoxRow[] {
  try {
    const parsed = JSON.parse(raw as string);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fallthrough */ }
  return [{ label: "", value: "" }];
}

async function uploadImageFile(file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/articles/images", { method: "POST", body: fd });
    if (!res.ok) return null;
    const data = await res.json() as { url: string };
    return data.url;
  } catch {
    return null;
  }
}

/**
 * A controlled text input that shows a [[wikilink]] autocomplete dropdown
 * when the user types [[ followed by a search query.
 */
interface WikilinkValueInputProps {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}

function WikilinkValueInput({ value, onChange, className, placeholder }: WikilinkValueInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingCursor, setPendingCursor] = useState<number | null>(null);
  const { isOpen, items, selectedIndex, onInputChange, handleKeyDown: acKeyDown, dismiss } =
    useWikilinkAutocomplete();

  // After a wikilink is inserted, move the cursor to just after the ]] — this
  // must happen after React has re-rendered with the new value, so we defer it.
  useEffect(() => {
    if (pendingCursor === null || !inputRef.current) return;
    inputRef.current.setSelectionRange(pendingCursor, pendingCursor);
    setPendingCursor(null);
  }, [pendingCursor, value]);

  const doInsert = useCallback(
    (item: WikilinkSuggestion) => {
      const cursor = inputRef.current?.selectionStart ?? value.length;
      // Guard: only insert if there is still an unclosed [[ at the cursor. A
      // stale async response may have kept the dropdown open after the user
      // already closed the fragment (typed ]]) or moved the cursor elsewhere.
      if (getWikilinkQueryAtCursor(value, cursor) === null) {
        dismiss();
        return;
      }
      const { newValue, newCursor } = insertWikilink(value, cursor, item.title);
      onChange(newValue);
      setPendingCursor(newCursor);
      dismiss();
      // Restore focus so the user can keep typing
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [value, onChange, dismiss],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter with an open dropdown: insert the selected suggestion
    if (e.key === "Enter" && isOpen && items.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      const item = items[selectedIndex];
      if (item) doInsert(item);
      return;
    }
    // Arrow keys / Escape: delegate to the autocomplete hook
    acKeyDown(e);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Small delay so a click on a dropdown item fires before the blur closes it
          setTimeout(dismiss, 150);
        }}
        onClick={(e) => e.stopPropagation()}
      />
      {isOpen && items.length > 0 && (
        <div
          className="absolute left-0 top-full z-50 mt-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden min-w-[180px] max-w-[260px] max-h-[200px] overflow-y-auto"
          // Prevent the input from losing focus when clicking inside the dropdown
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((item, idx) => (
            <button
              key={item.slug}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                idx === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              }`}
              onClick={() => doInsert(item)}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoBoxView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const title = (node.attrs.title as string) ?? "";
  const rows: InfoBoxRow[] = safeParseRows(node.attrs.rows);
  const image = (node.attrs.image as string) ?? "";
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setTitle = (v: string) => updateAttributes({ title: v });
  const setRows = (r: InfoBoxRow[]) => updateAttributes({ rows: JSON.stringify(r) });
  const setImage = (url: string) => updateAttributes({ image: url });

  const addRow = () => setRows([...rows, { label: "", value: "" }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: "label" | "value", val: string) =>
    setRows(rows.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));

  const handleUpload = async (file: File) => {
    setUploading(true);
    const url = await uploadImageFile(file);
    setUploading(false);
    if (url) setImage(url);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const item = Array.from(e.clipboardData.items).find((it) =>
      it.type.startsWith("image/"),
    );
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    const file = item.getAsFile();
    if (file) void handleUpload(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const file = e.dataTransfer.files[0];
    if (!file?.type.startsWith("image/")) return;
    e.preventDefault();
    e.stopPropagation();
    void handleUpload(file);
  };

  return (
    <NodeViewWrapper
      as="div"
      className={`infobox-editor not-prose ${selected ? "ring-2 ring-primary rounded" : ""}`}
      style={{ float: "right", clear: "right", margin: "0 0 1rem 1.5rem", width: "260px" }}
    >
      <div className="border border-border rounded overflow-hidden text-sm bg-card shadow-sm select-none">
        {/* Title */}
        <div className="bg-primary/10 border-b border-border px-2 py-2">
          <input
            className="w-full bg-transparent text-center font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none text-sm"
            placeholder="Infobox title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Image zone — focusable so Ctrl+V paste works; file picker only opens via the inner button */}
        <div
          className={`relative border-b border-border ${image ? "bg-black/5" : "bg-muted/20 hover:bg-muted/40 transition-colors"}`}
          style={{ minHeight: image ? undefined : "64px" }}
          tabIndex={image ? undefined : 0}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          {uploading ? (
            <div className="flex items-center justify-center h-16 text-muted-foreground text-xs gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Uploading…
            </div>
          ) : image ? (
            <div className="relative group/img flex justify-center">
              <img
                src={image}
                alt=""
                draggable={false}
                className="object-contain"
                style={{ maxHeight: "160px", maxWidth: "100%" }}
              />
              <button
                onMouseDown={(e) => { e.preventDefault(); setImage(""); }}
                className="absolute top-1 right-1 bg-background/80 rounded p-0.5 opacity-0 group-hover/img:opacity-100 transition-opacity"
                title="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            /* Clicking the label opens the file picker; clicking elsewhere in the zone just focuses it for paste */
            <button
              type="button"
              className="flex flex-col items-center justify-center w-full h-16 text-muted-foreground text-xs gap-1 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              title="Click to browse, or paste / drop an image"
            >
              <ImageIcon className="h-4 w-4" />
              <span>Click to browse or paste image</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Rows */}
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
                    <WikilinkValueInput
                      className="w-full bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none text-xs"
                      placeholder="Value"
                      value={row.value}
                      onChange={(v) => updateRow(i, "value", v)}
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

        {/* Footer */}
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
  // Higher priority than the Table extension (default 100) so that
  // infobox parse rules are registered first and win the <table.infobox>
  // match before the generic <table> rule can intercept it.
  priority: 200,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      title: { default: "" },
      rows: { default: JSON.stringify([{ label: "", value: "" }]) },
      image: { default: "" },
    };
  },

  parseHTML() {
    return [
      // New format: <div data-type="infobox" data-title="…" data-rows="…" data-image="…">
      {
        tag: 'div[data-type="infobox"]',
        getAttrs(el) {
          const node = el as HTMLElement;
          return {
            title: node.getAttribute("data-title") ?? "",
            rows: node.getAttribute("data-rows") ?? JSON.stringify([{ label: "", value: "" }]),
            image: node.getAttribute("data-image") ?? "",
          };
        },
      },
      // Legacy format: <table class="infobox"> — keeps existing saved articles working.
      {
        tag: "table.infobox",
        getAttrs(el) {
          const node = el as HTMLElement;
          const caption = node.querySelector("caption");
          const title = caption?.textContent?.trim() ?? "";
          const imgEl = node.querySelector("td img");
          const image = imgEl?.getAttribute("src") ?? "";
          const rows: InfoBoxRow[] = Array.from(node.querySelectorAll("tr"))
            .filter((tr) => tr.querySelector("th") && tr.querySelector("td"))
            .map((tr) => ({
              label: (tr.querySelector("th")?.textContent ?? "").trim(),
              value: (tr.querySelector("td")?.textContent ?? "").trim(),
            }))
            .filter((r) => r.label || r.value);
          return { title, rows: JSON.stringify(rows.length ? rows : [{ label: "", value: "" }]), image };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const title = (HTMLAttributes.title as string) ?? "";
    const imageUrl = (HTMLAttributes.image as string) ?? "";
    const rows: InfoBoxRow[] = safeParseRows(HTMLAttributes.rows);

    const trNodes = rows
      .filter((r) => r.label || r.value)
      .map((r): [string, object, ...unknown[]] => [
        "tr", {},
        ["th", {}, r.label],
        ["td", {}, r.value],
      ]);

    const imageRow: [string, object, ...unknown[]] | null = imageUrl
      ? [
          "tr", {},
          [
            "td",
            { colspan: "2", style: "text-align:center;padding:6px 4px" },
            ["img", { src: imageUrl, style: "max-width:100%;max-height:160px;object-fit:contain" }],
          ],
        ]
      : null;

    return [
      "div",
      mergeAttributes({
        "data-type": "infobox",
        "data-title": title,
        "data-rows": HTMLAttributes.rows as string,
        ...(imageUrl ? { "data-image": imageUrl } : {}),
      }),
      [
        "table",
        { class: "infobox" },
        ...(title ? [["caption", {}, title] as [string, object, string]] : []),
        ["tbody", {}, ...(imageRow ? [imageRow] : []), ...trNodes],
      ],
    ] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  },

  addNodeView() {
    return ReactNodeViewRenderer(InfoBoxView);
  },
});
