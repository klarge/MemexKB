import { useCallback, useRef } from "react";
import { useState } from "react";
import { Download, Pencil } from "lucide-react";
import { downloadStoredDiagram } from "@/lib/diagram-png";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

export function ResizableImageView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const [dlError, setDlError] = useState<string | null>(null);
  const isDiagram = node.attrs.diagram === "drawio";
  const editable = editor.isEditable;
  const download = (kind: "png" | "drawio") => {
    setDlError(null);
    downloadStoredDiagram(node.attrs.src as string, kind).catch((e) => setDlError(e instanceof Error ? e.message : "Download failed"));
  };
  const edit = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    window.dispatchEvent(new CustomEvent("lexikon:edit-diagram", { detail: { editor, pos, src: node.attrs.src } }));
  };
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startX.current = e.clientX;
      // A PNG export may be much larger than its rendered image. Start at the
      // displayed size, not the source's natural size, to avoid a width jump.
      const image = e.currentTarget.parentElement?.querySelector("img");
      startWidth.current = image?.getBoundingClientRect().width || (node.attrs.width as number) || 400;
      const style = getComputedStyle(editor.view.dom);
      const maxWidth = Math.max(80, editor.view.dom.clientWidth -
        (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));

      const onMouseMove = (ev: MouseEvent) => {
        const diff = ev.clientX - startX.current;
        const newWidth = Math.min(maxWidth, Math.max(80, startWidth.current + diff));
        updateAttributes({ width: newWidth });
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [node.attrs.width, updateAttributes, editor],
  );

  const width = node.attrs.width as number | null;

  return (
    <NodeViewWrapper
      className="relative inline-block group"
      style={{ width: width ? `${width}px` : undefined, maxWidth: "100%" }}
    >
      <img
        src={node.attrs.src as string}
        data-diagram={isDiagram ? "drawio" : undefined}
        alt={(node.attrs.alt as string) || ""}
        title={(node.attrs.title as string) || undefined}
        style={{ width: "100%", display: "block" }}
        className={`rounded transition-shadow ${selected ? "ring-2 ring-primary" : ""}`}
        draggable={false}
      />
      <input
        type="text"
        aria-label="Image caption"
        placeholder="Add caption…"
        value={(node.attrs.caption as string) || ""}
        onChange={(e) => updateAttributes({ caption: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="mt-1 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-center text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60 focus:border-border focus:bg-background"
      />
      {isDiagram && (
        <div className="absolute left-1 top-1 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" contentEditable={false}>
          {editable && (
            <button type="button" onClick={edit} onMouseDown={(e) => e.stopPropagation()} className="flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs shadow-sm hover:bg-muted" data-testid="button-edit-diagram">
              <Pencil className="h-3 w-3" /> Edit diagram
            </button>
          )}
          <button type="button" onClick={() => download("png")} onMouseDown={(e) => e.stopPropagation()} className="flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs shadow-sm hover:bg-muted" data-testid="button-download-diagram-png">
            <Download className="h-3 w-3" /> PNG
          </button>
          <button type="button" onClick={() => download("drawio")} onMouseDown={(e) => e.stopPropagation()} className="flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs shadow-sm hover:bg-muted" data-testid="button-download-diagram-drawio">
            <Download className="h-3 w-3" /> .drawio
          </button>
        </div>
      )}
      {dlError && <div className="text-center text-xs text-destructive" role="alert">{dlError}</div>}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 bg-primary/80 rounded-tl cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onMouseDown={onMouseDown}
        title="Drag to resize"
      />
    </NodeViewWrapper>
  );
}
