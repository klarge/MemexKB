import StarterKit from "@tiptap/starter-kit";
import type { Node } from "@tiptap/core";

// Upstream omits type="1", which would turn an explicit nested numeric
// list back into our automatic alphabetic default after saving.
export default StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(extension =>
      extension.name === "orderedList" ? (extension as Node).extend({
        renderHTML({ HTMLAttributes }) {
          const { start, ...attributes } = HTMLAttributes;
          if (attributes.type) attributes["data-list-style"] = attributes.type;
          return ["ol", start === 1 ? attributes : { ...attributes, start }, 0];
        },
      }) : extension,
    );
  },
});
