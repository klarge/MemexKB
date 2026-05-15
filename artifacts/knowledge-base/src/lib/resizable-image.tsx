import { useCallback, useRef } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startX.current = e.clientX;
      startWidth.current = (node.attrs.width as number) || (e.currentTarget.parentElement?.querySelector("img")?.naturalWidth ?? 400);

      const onMouseMove = (ev: MouseEvent) => {
        const diff = ev.clientX - startX.current;
        const newWidth = Math.max(80, startWidth.current + diff);
        updateAttributes({ width: newWidth });
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [node.attrs.width, updateAttributes],
  );

  const width = node.attrs.width as number | null;

  return (
    <NodeViewWrapper
      className="relative inline-block group"
      style={{ width: width ? `${width}px` : undefined }}
    >
      <img
        src={node.attrs.src as string}
        alt={(node.attrs.alt as string) || ""}
        title={(node.attrs.title as string) || undefined}
        style={{ width: "100%", display: "block" }}
        className={`rounded transition-shadow ${selected ? "ring-2 ring-primary" : ""}`}
        draggable={false}
      />
      <div
        className="absolute bottom-0 right-0 w-4 h-4 bg-primary/80 rounded-tl cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onMouseDown={onMouseDown}
        title="Drag to resize"
      />
    </NodeViewWrapper>
  );
}
