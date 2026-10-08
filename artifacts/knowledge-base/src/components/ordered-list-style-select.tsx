import { useEditorState, type Editor } from "@tiptap/react";

export function OrderedListStyleSelect({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      active: editor.isActive("orderedList"),
      style: editor.getAttributes("orderedList").type ?? "auto",
    }),
  });

  return (
    <select
      aria-label="Ordered list numbering"
      title="Ordered list numbering"
      className="h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
      disabled={!state.active}
      value={state.style}
      onChange={event => {
        const type = event.target.value === "auto" ? null : event.target.value;
        editor.chain().focus().command(({ tr, state }) => {
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth);
            if (node.type.name === "orderedList") {
              tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, type });
              return true;
            }
          }
          return false;
        }).run();
      }}
    >
      <option value="auto">Automatic</option>
      <option value="1">Numbers (1, 2, 3)</option>
      <option value="a">Letters (a, b, c)</option>
      {["A", "i", "I"].includes(state.style) && <option value={state.style}>Imported style ({state.style})</option>}
    </select>
  );
}
