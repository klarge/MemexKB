import { useEditorState, type Editor } from "@tiptap/react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

export function OrderedListStyleSelect({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      active: editor.isActive("orderedList"),
      style: editor.getAttributes("orderedList").type ?? "auto",
    }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Ordered list numbering"
          title="Ordered list numbering"
          disabled={!state.active}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={event => {
        if (editor.isFocused) event.preventDefault();
      }}>
        <DropdownMenuRadioGroup value={state.style} onValueChange={value => {
          const type = value === "auto" ? null : value;
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
        }}>
          <DropdownMenuRadioItem value="auto">Automatic</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="1">Numbers (1, 2, 3)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="a">Letters (a, b, c)</DropdownMenuRadioItem>
          {["A", "i", "I"].includes(state.style) && (
            <DropdownMenuRadioItem value={state.style}>Imported style ({state.style})</DropdownMenuRadioItem>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
