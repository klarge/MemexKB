import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";

export const WikilinkPluginKey = new PluginKey("wikilink");

export interface WikilinkItem {
  slug: string;
  title: string;
}

export interface WikilinkExtensionOptions {
  suggestion: Partial<SuggestionOptions<WikilinkItem>>;
}

export const WikilinkExtension = Extension.create<WikilinkExtensionOptions>({
  name: "wikilink",

  addOptions() {
    return {
      suggestion: {
        char: "[[",
        pluginKey: WikilinkPluginKey,
        allowSpaces: true,

        // Deactivate the suggestion as soon as the text from the trigger to
        // the cursor contains ']]' — this fires immediately after a link is
        // committed (either via the picker or typed manually), so the popup
        // closes without requiring an Escape press on any platform.
        allow: ({ state, range }: { state: import("@tiptap/pm/state").EditorState; range: { from: number; to: number } }) => {
          const text = state.doc.textBetween(range.from, range.to, undefined, "\ufffc");
          return !text.includes("]]");
        },

        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: { from: number; to: number };
          props: WikilinkItem;
        }) => {
          // Insert [[title]] followed by a space so the cursor lands in a
          // natural typing position. The 'allow' predicate above then fires,
          // sees ']]' in the suggestion text, and deactivates the popup.
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(`[[${props.title}]] `)
            .run();
        },
        items: (): WikilinkItem[] => [],
        render: () => ({
          onStart: (_props: SuggestionProps<WikilinkItem>) => {},
          onUpdate: (_props: SuggestionProps<WikilinkItem>) => {},
          onKeyDown: (_props: SuggestionKeyDownProps) => false,
          onExit: () => {},
        }),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<WikilinkItem>({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
