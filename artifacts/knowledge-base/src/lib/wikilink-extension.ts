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
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: { from: number; to: number };
          props: WikilinkItem;
        }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(`[[${props.title}]]`)
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
