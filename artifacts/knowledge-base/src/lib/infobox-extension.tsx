import { KIND_LABEL, normalizeKind } from "./content-paths";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  useWikilinkAutocomplete,
  insertWikilink,
  getWikilinkQueryAtCursor,
  type WikilinkSuggestion,
} from "./use-wikilink-autocomplete";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Trash2, Plus, Loader2, X, ArrowUp, ArrowDown, Image as ImageIcon } from "lucide-react";

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

function resizeInfoboxTextarea(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  // A newly mounted textarea can report a zero scrollHeight while its
  // ProseMirror node view is settling into the document. Keep one line of
  // clickable surface in that case; subsequent changes still grow normally.
  const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
  const minimumHeight = Math.max(Number.isFinite(lineHeight) ? lineHeight : 0, 20);
  element.style.height = `${Math.max(element.scrollHeight, minimumHeight)}px`;
}

function renderInfoboxText(value: string): unknown[] {
  return value.split("\n").flatMap((line, index) => [
    ...(index > 0 ? [["br"]] : []),
    line,
  ]);
}

/**
 * React must receive the new value in the input's own change event. Node-view
 * attribute updates arrive through a separate renderer; using those props alone
 * makes React briefly restore the old value and moves the caret to the end.
 * Still follow external changes, including editor undo/redo and restored content.
 */
function useInfoboxField(value: string, onChange: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  useLayoutEffect(() => { setDraft(value); }, [value]);
  const change = (next: string) => {
    setDraft(next);
    onChange(next);
  };
  return [draft, change] as const;
}

function WikilinkValueInput({ value: savedValue, onChange: saveValue, className, placeholder }: WikilinkValueInputProps) {
  const [value, onChange] = useInfoboxField(savedValue, saveValue);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  useEffect(() => {
    if (inputRef.current) resizeInfoboxTextarea(inputRef.current);
  }, [value]);

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
      const { newValue, newCursor } = insertWikilink(value, cursor, item.title, item.slug);
      onChange(newValue);
      setPendingCursor(newCursor);
      dismiss();
      // Restore focus so the user can keep typing
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [value, onChange, dismiss],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.shiftKey) {
      // Let the textarea insert the line break, but keep the parent editor
      // from interpreting this as an editor-level hard break.
      e.stopPropagation();
      dismiss();
      return;
    }
    // Enter with an open dropdown: insert the selected suggestion
    if (e.key === "Enter" && isOpen && items.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      const item = items[selectedIndex];
      if (item) doInsert(item);
      return;
    }
    if (e.key === "Enter") {
      // Preserve the cell's previous single-line Enter behavior.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Arrow keys / Escape: delegate to the autocomplete hook
    acKeyDown(e);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={inputRef}
        className={`${className ?? ""} select-text min-h-5`}
        placeholder={placeholder}
        rows={1}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
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
              <span className="ml-2 text-[10px] uppercase text-muted-foreground">{KIND_LABEL[normalizeKind(item.kind)]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface InfoboxCellInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

function InfoboxCellInput({ value: savedValue, onChange: saveValue, className, placeholder }: InfoboxCellInputProps) {
  const [value, onChange] = useInfoboxField(savedValue, saveValue);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (inputRef.current) resizeInfoboxTextarea(inputRef.current);
  }, [value]);

  return (
    <textarea
      ref={inputRef}
      className={`${className ?? ""} select-text min-h-5`}
      placeholder={placeholder}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.stopPropagation();
        if (!e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function InfoBoxView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const [title, setTitle] = useInfoboxField((node.attrs.title as string) ?? "", (v) => updateAttributes({ title: v }));
  const rows: InfoBoxRow[] = safeParseRows(node.attrs.rows);
  const image = (node.attrs.image as string) ?? "";
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<HTMLTableSectionElement>(null);
  const pendingRowFocus = useRef<{ index: number; direction: -1 | 1 } | null>(null);

  useLayoutEffect(() => {
    const move = pendingRowFocus.current;
    if (!move) return;
    pendingRowFocus.current = null;
    const row = rowsRef.current?.rows.item(move.index);
    const control = row?.querySelector<HTMLButtonElement>(`[data-row-move="${move.direction}"]`);
    // Follow the moved row, rather than the index-keyed button's old position.
    // At a boundary focus the row itself: Enter must not move a different row
    // or activate the opposite direction when the requested button is disabled.
    if (control && !control.disabled) control.focus();
    else row?.focus();
  }, [node.attrs.rows]);

  const setRows = (r: InfoBoxRow[]) => updateAttributes({ rows: JSON.stringify(r) });
  const setImage = (url: string) => updateAttributes({ image: url });

  const addRow = () => setRows([...rows, { label: "", value: "" }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: "label" | "value", val: string) =>
    setRows(rows.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));
  const moveRow = (from: number, direction: -1 | 1) => {
    const to = from + direction;
    if (to < 0 || to >= rows.length) return;
    const reordered = [...rows];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    pendingRowFocus.current = { index: to, direction };
    setRows(reordered);
  };

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
      contentEditable={false}
      className={`infobox-editor not-prose ${selected ? "ring-2 ring-primary rounded" : ""}`}
      style={{ float: "right", clear: "right", margin: "0 0 1rem 1.5rem", width: "260px" }}
    >
      <div className="border border-border rounded overflow-hidden text-sm bg-card shadow-sm">
        {/* Title */}
        <div className="bg-primary/10 border-b border-border px-2 py-2">
          <input
            className="w-full select-text bg-transparent text-center font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none text-sm"
            placeholder="Infobox title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
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
          <tbody ref={rowsRef}>
            {rows.map((row, i) => (
              <tr key={i} tabIndex={-1} className="border-b border-border last:border-b-0 group/row">
                <th
                  className="px-2 py-1.5 align-top bg-muted/40 text-left border-r border-border"
                  style={{ width: "42%" }}
                >
                  <InfoboxCellInput
                    className="w-full resize-none overflow-hidden bg-transparent font-medium text-foreground placeholder:text-muted-foreground focus:outline-none text-xs"
                    placeholder="Label"
                    value={row.label}
                    onChange={(value) => updateRow(i, "label", value)}
                  />
                </th>
                <td className="px-2 py-1.5 align-top">
                  <div>
                    <WikilinkValueInput
                      className="w-full resize-none overflow-hidden bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none text-xs"
                      placeholder="Value"
                      value={row.value}
                      onChange={(v) => updateRow(i, "value", v)}
                    />
                    <div className="flex items-center justify-end gap-0.5 pt-1">
                      <button
                        type="button"
                        data-row-move="-1"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => moveRow(i, -1)}
                        disabled={i === 0}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        title="Move row up"
                        aria-label={`Move row ${i + 1} up`}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        data-row-move="1"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => moveRow(i, 1)}
                        disabled={i === rows.length - 1}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        title="Move row down"
                        aria-label={`Move row ${i + 1} down`}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => removeRow(i)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        title="Remove row"
                        aria-label={`Remove row ${i + 1}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Footer */}
        <div className="flex items-center justify-between px-2 py-1.5 bg-muted/20 border-t border-border">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={addRow}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add row
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={deleteNode}
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
        ["th", {}, ...renderInfoboxText(r.label)],
        ["td", {}, ...renderInfoboxText(r.value)],
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
